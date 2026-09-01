import { ConversationComputerSandboxReconciliationOutcomes, type ConversationComputerActivationCommand } from "@opencrane/backend/server/conversations";
import type { ConversationComputerSandboxReconciliationAuthority } from "@opencrane/backend/server/conversations";
import type { HistoryRecordedEvent, HistoryStore } from "@opencrane/backend/server/infra/history-store";

import type { OpenCraneConversationComputerSandboxReconciliationWorker } from "./conversation-computer-sandbox-reconciliation-composition.types";
import { _log } from "./log";

/** Binds status polling to the existing durable activation history rather than an in-memory wake. */
const _ACTIVATION_EVENT_TYPE = "opencrane.computer.activation-requested.v1";
/** Limits every reconciliation pass so one stalled Kubernetes read cannot starve unrelated claims. */
const _MAXIMUM_RECONCILIATIONS_PER_PASS = 8;
/** Polls claim status while a durable dispatch has not yet converged to warmth or compensation. */
const _RECONCILIATION_INTERVAL_MILLISECONDS = 1_000;

/**
 * Replays and follows the durable activation stream to reconcile outstanding SandboxClaim status.
 *
 * Persistent activation delivery acknowledges claim submission; this regular subscription supplies
 * the independent, restart-safe source needed to observe controller status after that acknowledgement.
 * Every locator is revalidated by the domain authority, and completed, stale, or blocked locators
 * leave the bounded in-memory polling set without changing durable history.
 *
 * Called by: `_Main` in `apps/opencrane/src/index.ts`.
 * @param historyStore - Opens the silo-scoped activation history from its first revision.
 * @param authority - Rechecks history and performs each claim-status reconciliation pass.
 * @param siloId - Selects the local activation stream.
 * @returns A worker that stops polling and closes its regular stream before KurrentDB closes.
 * @throws {Error} Propagates a failure to open the regular history subscription.
 */
export async function _StartConversationComputerSandboxReconciliationWorker(historyStore: HistoryStore, authority: ConversationComputerSandboxReconciliationAuthority, siloId: string): Promise<OpenCraneConversationComputerSandboxReconciliationWorker>
{
	const streamName = `computer-activations-${siloId}`;
	const subscription = await historyStore.subscribe({ streamName, fromRevision: 0n });
	const outstanding = new Map<string, ConversationComputerActivationCommand>();
	let stopping = false;
	let reconciliationPass: Promise<void> | null = null;
	let reconciliationCursor = 0;
	const listener = _ReadActivationLocators(subscription.events, streamName, outstanding);
	void listener.then(function _StoppedReconciliationListener()
	{
		if (!stopping)
			_FailReconciliationListener(new Error("conversation computer reconciliation listener ended unexpectedly"));
	}, function _FailedReconciliationListener(error: unknown)
	{
		if (!stopping)
			_FailReconciliationListener(error);
	});
	const interval = setInterval(function _ReconcileOutstandingClaims()
	{
		if (reconciliationPass !== null)
			return;
		reconciliationPass = _ReconcileOutstanding(authority, outstanding, reconciliationCursor).then(function _AdvanceReconciliationCursor(nextCursor)
		{
			reconciliationCursor = nextCursor;
		}).catch(function _LogReconciliationFailure(error: unknown)
		{
			_log.error({ err: error }, "conversation computer sandbox reconciliation pass failed");
		}).finally(function _FinishReconciliationPass()
		{
			reconciliationPass = null;
		});
	}, _RECONCILIATION_INTERVAL_MILLISECONDS);
	interval.unref();

	return {
		async stop(): Promise<void>
		{
			stopping = true;
			clearInterval(interval);
			await subscription.close();
			await reconciliationPass;
			await listener;
		},
	};
}

/** Reads activation history in stream order and retains only one polling locator per computer generation. */
async function _ReadActivationLocators(events: AsyncIterable<HistoryRecordedEvent>, streamName: string, outstanding: Map<string, ConversationComputerActivationCommand>): Promise<void>
{
	for await (const event of events)
	{
		const command = _ActivationLocator(event, streamName);
		if (command !== null)
			outstanding.set(`${command.computerId}:${command.generation}`, command);
	}
}

/** Reconciles one bounded batch and preserves only claims whose transient result is Pending. */
async function _ReconcileOutstanding(authority: ConversationComputerSandboxReconciliationAuthority, outstanding: Map<string, ConversationComputerActivationCommand>, cursor: number): Promise<number>
{
	const entries = [...outstanding.entries()];
	if (entries.length === 0)
		return 0;
	const start = cursor % entries.length;
	const batch = Array.from({ length: Math.min(entries.length, _MAXIMUM_RECONCILIATIONS_PER_PASS) }, (_value, index) => entries[(start + index) % entries.length]);
	await Promise.all(batch.map(async function _ReconcileOne([key, command]): Promise<void>
	{
		try
		{
			const outcome = await authority.reconcile(command);
			if (outcome !== ConversationComputerSandboxReconciliationOutcomes.Pending)
				outstanding.delete(key);
			if (outcome === ConversationComputerSandboxReconciliationOutcomes.Blocked)
				_log.error({ computerId: command.computerId, generation: command.generation, siloId: command.siloId }, "conversation computer sandbox reconciliation is blocked by release or claim evidence");
		}
		catch (error)
		{
			_log.error({ err: error, computerId: command.computerId, generation: command.generation, siloId: command.siloId }, "conversation computer sandbox status observation failed");
		}
	}));
	return (start + batch.length) % entries.length;
}

/** Validates one status-reconciliation locator without treating arbitrary stream data as a claim target. */
function _ActivationLocator(event: HistoryRecordedEvent, streamName: string): ConversationComputerActivationCommand | null
{
	if (event.streamName !== streamName || event.type !== _ACTIVATION_EVENT_TYPE)
		return null;
	const siloId = event.data["siloId"];
	const computerId = event.data["computerId"];
	const conversationId = event.data["conversationId"];
	const generation = event.data["generation"];
	if (typeof siloId !== "string" || streamName !== `computer-activations-${siloId}` || typeof computerId !== "string" || typeof conversationId !== "string" || typeof generation !== "number" || !Number.isSafeInteger(generation) || generation < 1)
		return null;
	return { siloId, computerId, conversationId, generation };
}

/** Logs and terminates because a stopped durable status source would strand acknowledged claim dispatches. */
function _FailReconciliationListener(error: unknown): void
{
	_log.fatal({ err: error }, "conversation computer sandbox reconciliation listener stopped unexpectedly");
	process.exit(1);
}
