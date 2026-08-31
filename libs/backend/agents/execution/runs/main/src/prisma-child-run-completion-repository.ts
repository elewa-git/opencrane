import { AgentRunState, ChildRunCompletionDeliveryOutcome, Prisma } from "@prisma/client";

import type { ChildRunCompletionCommand, ChildRunCompletionRepository, ChildRunCompletionResult } from "./child-run-completion.types";

/**
 * Delivers terminal child results through the authority transaction supplied by its caller.
 *
 * The child ledger and parent event stay in the caller's transaction so they cannot commit separately.
 *
 * Called by: `PrismaRuntimeTerminalChildDeliveryUnitOfWork.deliver`,
 * `PrismaAgentRunWarmRuntimeRepository._FinalizeCancelledRun`, and
 * `PrismaAgentRunAuthorityRepository._redeliverSuppressedChildren`.
 */
export class PrismaChildRunCompletionRepository implements ChildRunCompletionRepository
{
	/** Keeps every child and parent evidence write in the transaction supplied by the caller. */
	private readonly transaction: Prisma.TransactionClient;

	/**
	 * Binds child delivery to the transaction already opened by the lifecycle authority.
	 * @param transaction - Transaction that also owns the child or parent lifecycle change.
	 */
	constructor(transaction: Prisma.TransactionClient)
	{
		this.transaction = transaction;
	}

	/**
	 * Resolves one terminal child result without opening or committing another transaction.
	 * @param command - Identifies the child whose result must reach its direct parent.
	 * @returns The result saved for the current child and parent attempts, or its idempotent replay.
	 * @throws When a Prisma operation or database authority constraint fails.
	 */
	async deliver(command: ChildRunCompletionCommand): Promise<ChildRunCompletionResult>
	{
		if (command.childRunId.trim().length === 0)
			return { outcome: "denied", reason: "not_child_run" };
		// 1. Load the child's current attempt and terminal state before deriving a parent notification.
		const child = await this.transaction.agentRun.findUnique({ where: { id: command.childRunId } });
		if (child === null)
			return { outcome: "ignored", reason: "child_not_found" };
		if (!_isTerminal(child.state))
			return { outcome: "ignored", reason: "child_not_terminal" };
		if (child.parentRunId === null)
			return { outcome: "denied", reason: "not_child_run" };

		// 2. Load the direct parent stream before choosing its next sequence or terminal outcome.
		const parent = await this.transaction.agentRun.findUnique({ where: { id: child.parentRunId } });
		const reservation = await this.transaction.childRunReservation.findUnique({ where: { childRunId: child.id } });
		if (parent === null || reservation === null || !_hasExactLineage(child, parent, reservation))
			return { outcome: "denied", reason: "lineage_conflict" };
		// PostgreSQL permits a suppression for each parent attempt but only one delivered result for each
		// child attempt. Prisma cannot query that partial unique index by key, so inspect the append-only rows.
		let current: { readonly parentRunId: string; readonly outcome: ChildRunCompletionDeliveryOutcome; readonly parentEventSequence: number | null } | null = null;
		for (let parentAttempt = 1; parentAttempt <= parent.attempt; parentAttempt += 1)
		{
			const candidate = await this.transaction.childRunCompletionDelivery.findUnique({ where: { childRunId_childAttempt_parentAttempt: { childRunId: child.id, childAttempt: child.attempt, parentAttempt } } });
			if (candidate?.outcome === ChildRunCompletionDeliveryOutcome.Delivered)
				return _replay(candidate);
			if (parentAttempt === parent.attempt)
				current = candidate;
		}
		if (current !== null)
			return _replay(current);
		if (parent.conversationId === null)
			return this._recordSuppressed(child.id, child.attempt, parent.id, parent.attempt, ChildRunCompletionDeliveryOutcome.NoParentStream);
		const maximum = await this.transaction.conversationRunEvent.aggregate({ where: { runId: parent.id }, _max: { sequence: true } });
		const terminalEvents = await this.transaction.conversationRunEvent.findMany({ where: { runId: parent.id, attempt: parent.attempt, type: { in: ["run.completed", "run.failed", "run.cancelled"] } }, select: { type: true } });
		if (_hasTerminalEvent(terminalEvents))
			return this._recordSuppressed(child.id, child.attempt, parent.id, parent.attempt, ChildRunCompletionDeliveryOutcome.ParentStreamTerminal);

		// 3. Write the ledger before its matching parent event; the deferred database constraint makes the pair inseparable.
		const sequence = (maximum._max.sequence ?? 0) + 1;
		await this.transaction.childRunCompletionDelivery.create({ data: { childRunId: child.id, childAttempt: child.attempt, parentRunId: parent.id, parentAttempt: parent.attempt, parentEventSequence: sequence, outcome: ChildRunCompletionDeliveryOutcome.Delivered } });
		await this.transaction.conversationRunEvent.create({ data: { conversationId: parent.conversationId, runId: parent.id, attempt: parent.attempt, sequence, type: _eventType(child.state), payload: { childRunId: child.id, childAttempt: child.attempt, childState: _state(child.state), terminalReason: child.terminalReason, finishedAt: child.finishedAt?.toISOString() ?? null }, occurredAt: new Date() } });
		return { outcome: "delivered", parentRunId: parent.id, parentEventSequence: sequence };
	}

	/** Records why the current parent attempt cannot receive the child's completion event. */
	private async _recordSuppressed(childRunId: string, childAttempt: number, parentRunId: string, parentAttempt: number, outcome: ChildRunCompletionDeliveryOutcome): Promise<ChildRunCompletionResult>
	{
		await this.transaction.childRunCompletionDelivery.create({ data: { childRunId, childAttempt, parentRunId, parentAttempt, parentEventSequence: null, outcome } });
		return { outcome: "suppressed", parentRunId, reason: _suppressedReason(outcome) };
	}
}

/** Maps a persisted delivery ledger row into the same replay outcome across all callers. */
function _replay(delivery: { parentRunId: string; outcome: ChildRunCompletionDeliveryOutcome; parentEventSequence: number | null }): ChildRunCompletionResult
{
	return { outcome: "idempotent", parentRunId: delivery.parentRunId, parentEventSequence: delivery.parentEventSequence, delivery: _deliveryOutcome(delivery.outcome) };
}

/** Map a suppressed ledger category to the bounded parent-facing reason. */
function _suppressedReason(outcome: ChildRunCompletionDeliveryOutcome): "no_parent_stream" | "parent_stream_terminal"
{
	return outcome === ChildRunCompletionDeliveryOutcome.NoParentStream ? "no_parent_stream" : "parent_stream_terminal";
}

/** Map one ledger category to the bounded replay vocabulary. */
function _deliveryOutcome(outcome: ChildRunCompletionDeliveryOutcome): "delivered" | "no_parent_stream" | "parent_stream_terminal"
{
	if (outcome === ChildRunCompletionDeliveryOutcome.Delivered)
		return "delivered";
	return _suppressedReason(outcome);
}

/** Returns whether a run state has immutable terminal outcome evidence. */
function _isTerminal(state: AgentRunState): boolean
{
	return state === AgentRunState.Completed || state === AgentRunState.Failed || state === AgentRunState.Cancelled;
}

/** Verifies that the reservation, child, and parent form one exact inherited-silo lineage. */
function _hasExactLineage(child: { id: string; siloId: string; parentRunId: string | null; rootRunId: string }, parent: { id: string; siloId: string; rootRunId: string }, reservation: { childRunId: string; parentRunId: string; rootRunId: string }): boolean
{
	return child.parentRunId === parent.id && child.siloId === parent.siloId && child.rootRunId === parent.rootRunId && reservation.childRunId === child.id && reservation.parentRunId === parent.id && reservation.rootRunId === parent.rootRunId;
}

/** Returns whether the parent stream has already accepted its sole terminal event. */
function _hasTerminalEvent(events: Array<{ type: string }>): boolean
{
	return events.length > 0;
}

/** Maps a child terminal state to its parent-stream event type. */
function _eventType(state: AgentRunState): "child.run.completed" | "child.run.failed" | "child.run.cancelled"
{
	if (state === AgentRunState.Completed)
		return "child.run.completed";
	if (state === AgentRunState.Failed)
		return "child.run.failed";
	return "child.run.cancelled";
}

/** Maps only terminal Prisma run states to the delivery payload vocabulary. */
function _state(state: AgentRunState): "completed" | "failed" | "cancelled"
{
	if (state === AgentRunState.Completed)
		return "completed";
	if (state === AgentRunState.Failed)
		return "failed";
	return "cancelled";
}
