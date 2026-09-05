import type * as k8s from "@kubernetes/client-node";
import type { PrismaClient } from "@prisma/client";
import { __RunConversationComputerActivationListener, ConversationComputerActivationAuthorityAdapter, PrismaConversationComputerActivationProjectionRepository, type ConversationComputerActivationProjectionRepository } from "@opencrane/backend/server/conversations";
import type { HistoryStore } from "@opencrane/backend/server/infra/history-store";
import { ___RunInPrismaUnitOfWork } from "@opencrane/backend/server/infra/prisma-unit-of-work";
import { AgentSandboxClaimAdapter } from "@opencrane/backend/server/infra/agent-sandbox";

import type { ConversationComputerActivationWorker } from "./conversation-computer-activation-composition.types";
import type { AgentSandboxReleaseProfileConfig } from "./config.types";
import { _log } from "./log";

/** Start the pre-provisioned persistent activation consumer for this silo. */
export async function _StartConversationComputerActivationWorker(prisma: PrismaClient, customApi: k8s.CustomObjectsApi, historyStore: HistoryStore, siloId: string, profile: AgentSandboxReleaseProfileConfig): Promise<ConversationComputerActivationWorker>
{
	const projections: ConversationComputerActivationProjectionRepository = {
		resolve: function _Resolve(command) { return ___RunInPrismaUnitOfWork(prisma, function _InTransaction(transaction) { const repository = new PrismaConversationComputerActivationProjectionRepository(transaction); return repository.resolve(command); }, { isolationLevel: "ReadCommitted", operation: "conversation computer activation projection" }); },
		publishActiveLease: function _PublishActiveLease(command) { return ___RunInPrismaUnitOfWork(prisma, function _InTransaction(transaction) { const repository = new PrismaConversationComputerActivationProjectionRepository(transaction); return repository.publishActiveLease(command); }, { isolationLevel: "Serializable", operation: "conversation computer active lease projection" }); },
	};
	const subscription = await historyStore.subscribePersistent({ streamName: `computer-activations-${siloId}`, groupName: "conversation-computer-activation" });
	const claims = new AgentSandboxClaimAdapter(customApi);
	const authority = new ConversationComputerActivationAuthorityAdapter(projections, historyStore, claims, profile);
	void __RunConversationComputerActivationListener(subscription, authority).catch(function _ActivationListenerFailed(error: unknown)
	{
		_log.fatal({ err: error }, "conversation computer activation listener stopped");
		process.exitCode = 1;
	});
	return { stop: async function _StopActivationWorker(): Promise<void> { await subscription.close(); } };
}
