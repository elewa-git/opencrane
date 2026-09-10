import type * as k8s from "@kubernetes/client-node";
import type { PrismaClient } from "@prisma/client";
import { __StartConversationComputerActivationConsumer } from "./conversation-computer-activation";
import { ConversationComputerActivationAuthorityAdapter } from "./conversation-computer-activation-authority";
import { PrismaConversationComputerActivationUnitOfWork } from "./db/prisma-conversation-computer-activation-unit-of-work";
import { ConversationComputerActivationConsumerEventKinds, ConversationComputerActivationConsumerStates, type ConversationComputerActivationConsumerEvent, type ConversationComputerActivationProfile } from "./conversation-computer-activation.types";
import type { HistoryStore } from "@opencrane/backend/server/infra/history-store";
import { AgentSandboxClaimAdapter } from "@opencrane/backend/server/infra/agent-sandbox";

import type { ConversationComputerActivationWorkerHandle, ConversationComputerActivationWorkerOptions } from "./conversation-computer-activation-composition.types";
import type { Logger } from "@opencrane/backend/observability";
import type { IWorkflowEngine } from "@opencrane/backend/server/infra/workflows/contract";

/** Consumer group the KurrentDB bootstrap Job provisions for every silo. */
const _ACTIVATION_GROUP = "conversation-computer-activation";

/**
 * Start this replica's competing consumer on the pre-provisioned silo activation group.
 *
 * Every replica joins the same group, so KurrentDB spreads deliveries across them and a rolling
 * restart never leaves the queue unread. A dropped subscription is reopened with backoff instead of
 * ending the process; only an exhausted reopen budget asks the process to shut down, which lets
 * Kubernetes replace that one replica while the others keep consuming.
 *
 * Called by: `_Main` in apps/opencrane/src/index.ts.
 */
export async function _StartConversationComputerActivationWorker(prisma: PrismaClient, customApi: k8s.CustomObjectsApi, historyStore: HistoryStore, workflows: Pick<IWorkflowEngine, "spawn">, siloId: string, profile: ConversationComputerActivationProfile, options: ConversationComputerActivationWorkerOptions): Promise<ConversationComputerActivationWorkerHandle>
{
	const projections = new PrismaConversationComputerActivationUnitOfWork(prisma, workflows);
	const claims = new AgentSandboxClaimAdapter(customApi);
	const authority = new ConversationComputerActivationAuthorityAdapter(projections, historyStore, claims, profile);
	const stop = new AbortController();
	const streamName = `computer-activations-${siloId}`;
	const consumer = __StartConversationComputerActivationConsumer(
		function _Open() { return historyStore.subscribePersistent({ streamName, groupName: _ACTIVATION_GROUP }); },
		authority,
		{ signal: stop.signal, resubscribe: options.resubscribe, wait: options.wait, onEvent: function _OnEvent(event) { _LogConsumerEvent(event, streamName, options.logger); } },
	);
	const onExhausted = options.onExhausted;
	void consumer.done.then(function _ConsumerSettled()
	{
		if (consumer.health().state === ConversationComputerActivationConsumerStates.Failed && !stop.signal.aborted)
			onExhausted();
	});
	return {
		health: consumer.health,
		stop: async function _StopActivationWorker(): Promise<void>
		{
			const failedBeforeStop = consumer.health().state === ConversationComputerActivationConsumerStates.Failed;
			stop.abort();
			await consumer.done;
			if (failedBeforeStop)
				throw new Error("conversation computer activation consumer used its reopen budget before shutdown");
		},
	};
}

/** Write one structured line per consumer observation; the Failed line is the operator's restart signal. */
function _LogConsumerEvent(event: ConversationComputerActivationConsumerEvent, streamName: string, logger: Pick<Logger, "info" | "warn" | "fatal">): void
{
	switch (event.kind)
	{
		case ConversationComputerActivationConsumerEventKinds.Subscribed:
			logger.info({ streamName, groupName: _ACTIVATION_GROUP }, "conversation computer activation consumer subscribed");
			return;
		case ConversationComputerActivationConsumerEventKinds.Dropped:
			logger.warn({ err: event.error, streamName, groupName: _ACTIVATION_GROUP, consecutiveFailures: event.consecutiveFailures, nextWaitMilliseconds: event.nextWaitMilliseconds }, "conversation computer activation subscription dropped; reopening");
			return;
		case ConversationComputerActivationConsumerEventKinds.Failed:
			logger.fatal({ err: event.error, streamName, groupName: _ACTIVATION_GROUP, consecutiveFailures: event.consecutiveFailures }, "conversation computer activation consumer gave up; requesting process shutdown");
			return;
		case ConversationComputerActivationConsumerEventKinds.Stopped:
			logger.info({ streamName, groupName: _ACTIVATION_GROUP }, "conversation computer activation consumer stopped");
	}
}
