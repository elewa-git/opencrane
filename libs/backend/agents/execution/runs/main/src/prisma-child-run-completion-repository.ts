import { AgentRunState, ChildRunCompletionDeliveryOutcome, Prisma, type PrismaClient } from "@prisma/client";

import { ___CreateLogger, type Logger } from "@opencrane/backend/observability";

import type { ChildRunCompletionCommand, ChildRunCompletionRepository, ChildRunCompletionResult } from "./child-run-completion.types.js";

/** Atomically records one terminal child result in its parent conversation stream. */
export class PrismaChildRunCompletionRepository implements ChildRunCompletionRepository
{
	/** Canonical product-authority database client. */
	private readonly prisma: PrismaClient;
	/** Structured redacting log for fail-closed persistence faults. */
	private readonly log: Logger;

	/** Creates the transaction-owning completion-delivery repository. */
	constructor(prisma: PrismaClient, log: Logger = ___CreateLogger("child-run-completion"))
	{
		this.prisma = prisma;
		this.log = log;
	}

	/** Delivers a terminal child exactly once, with a durable suppressed outcome when the parent stream is unavailable. */
	async deliverAtomically(command: ChildRunCompletionCommand): Promise<ChildRunCompletionResult>
	{
		if (command.childRunId.trim().length === 0) return { outcome: "denied", reason: "not_child_run" };
		try
		{
			return await this.prisma.$transaction(async function _deliver(transaction): Promise<ChildRunCompletionResult>
			{
				return __DeliverChildRunCompletionInTransaction(transaction, command);
			});
		}
		catch (error)
		{
			this.log.error({ err: error, childRunId: command.childRunId, failureKind: "transaction_failed" }, "child run completion delivery failed");
			return { outcome: "denied", reason: "persistence_unavailable" };
		}
	}
}

/** Delivers a terminal child through an already-open authority transaction. */
export async function __DeliverChildRunCompletionInTransaction(transaction: Prisma.TransactionClient, command: ChildRunCompletionCommand): Promise<ChildRunCompletionResult>
{
	if (command.childRunId.trim().length === 0) return { outcome: "denied", reason: "not_child_run" };
	// 1. Lock immutable child evidence before deriving any cross-run notification.
	await transaction.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${command.childRunId}, 0))`);
	await transaction.$queryRaw(Prisma.sql`SELECT "id" FROM "agent_runs" WHERE "id" = ${command.childRunId} FOR UPDATE`);
	const child = await transaction.agentRun.findUnique({ where: { id: command.childRunId } });
	if (child === null) return { outcome: "ignored", reason: "child_not_found" };
	if (!_isTerminal(child.state)) return { outcome: "ignored", reason: "child_not_terminal" };
	if (child.parentRunId === null) return { outcome: "denied", reason: "not_child_run" };
	const replay = await transaction.childRunCompletionDelivery.findUnique({ where: { childRunId: child.id } });
	if (replay !== null) return _replay(child.parentRunId, replay);

	// 2. Lock the direct parent stream before choosing its next sequence or terminal outcome.
	await transaction.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${child.parentRunId}, 0))`);
	await transaction.$queryRaw(Prisma.sql`SELECT "id" FROM "agent_runs" WHERE "id" = ${child.parentRunId} FOR UPDATE`);
	await transaction.$queryRaw(Prisma.sql`SELECT "child_run_id" FROM "child_run_reservations" WHERE "child_run_id" = ${child.id} FOR UPDATE`);
	const parent = await transaction.agentRun.findUnique({ where: { id: child.parentRunId } });
	const reservation = await transaction.childRunReservation.findUnique({ where: { childRunId: child.id } });
	if (parent === null || reservation === null || !_hasExactLineage(child, parent, reservation)) return { outcome: "denied", reason: "lineage_conflict" };
	if (parent.threadId === null) return _recordSuppressed(transaction, child.id, parent.id, ChildRunCompletionDeliveryOutcome.NoParentStream);
	const maximum = await transaction.conversationRunEvent.aggregate({ where: { runId: parent.id }, _max: { sequence: true } });
	if (_hasTerminalEvent(await transaction.conversationRunEvent.findMany({ where: { runId: parent.id, type: { in: ["run.completed", "run.failed", "run.cancelled"] } }, select: { type: true } }))) return _recordSuppressed(transaction, child.id, parent.id, ChildRunCompletionDeliveryOutcome.ParentStreamTerminal);

	// 3. Write the ledger before its matching parent event; the deferred database constraint makes the pair inseparable.
	const sequence = (maximum._max.sequence ?? 0) + 1;
	await transaction.childRunCompletionDelivery.create({ data: { childRunId: child.id, parentRunId: parent.id, parentEventSequence: sequence, outcome: ChildRunCompletionDeliveryOutcome.Delivered } });
	await transaction.conversationRunEvent.create({ data: { runId: parent.id, sequence, type: _eventType(child.state), payload: { childRunId: child.id, childAttempt: child.attempt, childState: _state(child.state), terminalReason: child.terminalReason, finishedAt: child.finishedAt?.toISOString() ?? null }, occurredAt: new Date() } });
	return { outcome: "delivered", parentRunId: parent.id, parentEventSequence: sequence };
}

/** Records a durable reason why the parent cannot receive a child completion event. */
async function _recordSuppressed(transaction: Prisma.TransactionClient, childRunId: string, parentRunId: string, outcome: ChildRunCompletionDeliveryOutcome): Promise<ChildRunCompletionResult>
{
	await transaction.childRunCompletionDelivery.create({ data: { childRunId, parentRunId, parentEventSequence: null, outcome } });
	return { outcome: "suppressed", parentRunId, reason: outcome === ChildRunCompletionDeliveryOutcome.NoParentStream ? "no_parent_stream" : "parent_stream_terminal" };
}

/** Maps a persisted delivery ledger row into the same replay outcome across all callers. */
function _replay(parentRunId: string, delivery: { outcome: ChildRunCompletionDeliveryOutcome; parentEventSequence: number | null }): ChildRunCompletionResult
{
	return { outcome: "idempotent", parentRunId, parentEventSequence: delivery.parentEventSequence, delivery: delivery.outcome === ChildRunCompletionDeliveryOutcome.Delivered ? "delivered" : delivery.outcome === ChildRunCompletionDeliveryOutcome.NoParentStream ? "no_parent_stream" : "parent_stream_terminal" };
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
	if (state === AgentRunState.Completed) return "child.run.completed";
	if (state === AgentRunState.Failed) return "child.run.failed";
	return "child.run.cancelled";
}

/** Maps only terminal Prisma run states to the delivery payload vocabulary. */
function _state(state: AgentRunState): "completed" | "failed" | "cancelled"
{
	if (state === AgentRunState.Completed) return "completed";
	if (state === AgentRunState.Failed) return "failed";
	return "cancelled";
}
