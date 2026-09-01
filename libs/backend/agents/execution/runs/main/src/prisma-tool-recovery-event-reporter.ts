import { AgentRunState, Prisma } from "@prisma/client";

import type { ToolInvocationRecoveryEvent, ToolInvocationRecoveryEventSink } from "@opencrane/backend/server/iam/authorization";
import { RunEventTypes } from "@opencrane/models/agents";

import type { ToolRecoveryEventAppendRepository, ToolRecoveryEventAppendUnitOfWork } from "./tool-recovery-event-reporter.types";

/**
 * Writes the run event that tells a conversation a tool invocation needs recovery.
 *
 * Only appends while the run is still on the expected attempt and still in RecoveryRequired, so an
 * out-of-date caller cannot announce a recovery that no longer applies. A run with no conversation
 * succeeds without writing anything — its state on the run row is the whole record.
 *
 * Called by: `apps/opencrane/src/app/external-action-composition.ts`, which passes it to the
 * external-action worker as the recovery event sink.
 *
 * @implements ToolInvocationRecoveryEventSink
 */
export class PrismaToolRecoveryEventReporter implements ToolInvocationRecoveryEventSink
{
	/** Appends the recovery event, using the transaction the caller already holds. */
	async appendInTransaction(transaction: Prisma.TransactionClient, event: ToolInvocationRecoveryEvent): Promise<boolean>
	{
		const unitOfWork = new PrismaToolRecoveryEventAppendUnitOfWork(transaction);
		return unitOfWork.append(event);
	}
}

/** Builds the repository that appends the event, bound to the caller's transaction. */
class PrismaToolRecoveryEventAppendUnitOfWork implements ToolRecoveryEventAppendUnitOfWork
{
	/** The caller's transaction for this invocation state change. */
	private readonly _transaction: Prisma.TransactionClient;
	/** Keeps the repository on the caller's transaction. */
	constructor(transaction: Prisma.TransactionClient) { this._transaction = transaction; }
	/** Appends the event through a repository bound to that transaction. */
	async append(event: ToolInvocationRecoveryEvent): Promise<boolean>
	{
		const repository = new PrismaToolRecoveryEventAppendRepository(this._transaction);
		return repository.append(event);
	}
}

/** Prisma adapter that numbers the recovery event and writes it. */
class PrismaToolRecoveryEventAppendRepository implements ToolRecoveryEventAppendRepository
{
	/** The caller's transaction for this invocation state change. */
	private readonly _transaction: Prisma.TransactionClient;
	/** Bind all reads and writes to one invocation transaction. */
	constructor(transaction: Prisma.TransactionClient) { this._transaction = transaction; }
	/** Appends only while the run is still on this attempt and still in RecoveryRequired. */
	async append(event: ToolInvocationRecoveryEvent): Promise<boolean>
	{
		// 1. Re-read the run: if it has moved to another attempt or left RecoveryRequired, an out-of-date caller must not write an event.
		const run = await this._transaction.agentRun.findUnique({ where: { id: event.runId } });
		if (run === null || run.attempt !== event.expectedAttempt || run.state !== AgentRunState.RecoveryRequired) return false;

		// 2. Managed runs have no conversation stream; the durable run state remains authoritative.
		if (run.conversationId === null) return true;

		// 3. Append the fixed, secret-free payload at the next sequence number, inside the caller's transaction.
		const maximum = await this._transaction.conversationRunEvent.aggregate({ where: { runId: run.id }, _max: { sequence: true } });
		await this._transaction.conversationRunEvent.create({ data: { conversationId: run.conversationId, runId: run.id, attempt: run.attempt, sequence: (maximum._max.sequence ?? 0) + 1, type: RunEventTypes.ToolRecoveryRequired, payload: { toolInvocationId: event.toolInvocationId, toolCallId: event.toolInvocationId, expectedAttempt: event.expectedAttempt, preparationRetryCount: event.preparationRetryCount, preparationRetryLimit: event.preparationRetryLimit, providerOutcome: event.providerOutcome }, occurredAt: new Date() } });
		return true;
	}
}
