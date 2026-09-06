import { AgentRunState, Prisma } from "@prisma/client";

import type { ToolInvocationRecoveryEvent, ToolInvocationRecoveryEventSink } from "@opencrane/backend/server/iam/authorization";

import type { ToolRecoveryEventAppendRepository, ToolRecoveryEventAppendUnitOfWork } from "./tool-recovery-event-reporter.types";

/**
 * Confirms that a tool invocation recovery still applies to the current run attempt.
 *
 * Returns true only while the run is still on the expected attempt and still in RecoveryRequired, so
 * an out-of-date caller cannot announce a recovery that no longer applies. Nothing is written: the
 * run row's state is the durable record, and participant-visible history lives in the KurrentDB
 * conversation stream.
 *
 * Called by: `apps/opencrane/src/app/external-action-composition.ts`, which passes it to the
 * external-action worker as the recovery event sink.
 *
 * @implements ToolInvocationRecoveryEventSink
 */
export class PrismaToolRecoveryEventReporter implements ToolInvocationRecoveryEventSink
{
	/** Checks the recovery event against the run fence, using the transaction the caller already holds. */
	async appendInTransaction(transaction: Prisma.TransactionClient, event: ToolInvocationRecoveryEvent): Promise<boolean>
	{
		const unitOfWork = new PrismaToolRecoveryEventAppendUnitOfWork(transaction);
		return unitOfWork.append(event);
	}
}

/** Builds the repository that checks the event, bound to the caller's transaction. */
class PrismaToolRecoveryEventAppendUnitOfWork implements ToolRecoveryEventAppendUnitOfWork
{
	/** The caller's transaction for this invocation state change. */
	private readonly _transaction: Prisma.TransactionClient;
	/** Keeps the repository on the caller's transaction. */
	constructor(transaction: Prisma.TransactionClient) { this._transaction = transaction; }
	/** Checks the event through a repository bound to that transaction. */
	async append(event: ToolInvocationRecoveryEvent): Promise<boolean>
	{
		const repository = new PrismaToolRecoveryEventAppendRepository(this._transaction);
		return repository.append(event);
	}
}

/** Prisma adapter that rechecks the run fence for one recovery event. */
class PrismaToolRecoveryEventAppendRepository implements ToolRecoveryEventAppendRepository
{
	/** The caller's transaction for this invocation state change. */
	private readonly _transaction: Prisma.TransactionClient;
	/** Bind all reads and writes to one invocation transaction. */
	constructor(transaction: Prisma.TransactionClient) { this._transaction = transaction; }
	/** True only while the run is still on this attempt and still in RecoveryRequired. */
	async append(event: ToolInvocationRecoveryEvent): Promise<boolean>
	{
		// Re-read the run: if it has moved to another attempt or left RecoveryRequired, an out-of-date caller must not announce a recovery.
		const run = await this._transaction.agentRun.findUnique({ where: { id: event.runId } });
		return run !== null && run.attempt === event.expectedAttempt && run.state === AgentRunState.RecoveryRequired;
	}
}
