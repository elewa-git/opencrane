import { AgentRunState, Prisma } from "@prisma/client";

import type { ToolInvocationRecoveryEvent, ToolInvocationRecoveryEventSink } from "@opencrane/backend/server/iam/authorization";
import { RunEventTypes } from "@opencrane/models/agents";

import type { ToolRecoveryEventAppendRepository, ToolRecoveryEventAppendUnitOfWork } from "./tool-recovery-event-reporter.types.js";

/** Canonical run-event sink for a ToolInvocation recovery transition. */
export class PrismaToolRecoveryEventReporter implements ToolInvocationRecoveryEventSink
{
	/** Append one bounded recovery event while the invocation owner holds the same transaction. */
	async appendInTransaction(transaction: Prisma.TransactionClient, event: ToolInvocationRecoveryEvent): Promise<boolean>
	{
		return new PrismaToolRecoveryEventAppendUnitOfWork(transaction).append(event);
	}
}

/** Transaction-owned construction boundary for the recovery-event repository. */
class PrismaToolRecoveryEventAppendUnitOfWork implements ToolRecoveryEventAppendUnitOfWork
{
	/** Exact invocation transition transaction. */
	private readonly _transaction: Prisma.TransactionClient;
	/** Bind repository construction to the invocation transaction. */
	constructor(transaction: Prisma.TransactionClient) { this._transaction = transaction; }
	/** Append through one exact transaction-bound repository. */
	async append(event: ToolInvocationRecoveryEvent): Promise<boolean> { return new PrismaToolRecoveryEventAppendRepository(this._transaction).append(event); }
}

/** Prisma adapter that owns recovery-event sequencing and persistence. */
class PrismaToolRecoveryEventAppendRepository implements ToolRecoveryEventAppendRepository
{
	/** Exact invocation transition transaction. */
	private readonly _transaction: Prisma.TransactionClient;
	/** Bind all reads and writes to one invocation transaction. */
	constructor(transaction: Prisma.TransactionClient) { this._transaction = transaction; }
	/** Append only when the exact run attempt remains recovery-required. */
	async append(event: ToolInvocationRecoveryEvent): Promise<boolean>
	{
		// 1. Recheck the exact recovery-required attempt so a stale invocation cannot publish an event.
		const run = await this._transaction.agentRun.findUnique({ where: { id: event.runId } });
		if (run === null || run.attempt !== event.expectedAttempt || run.state !== AgentRunState.RecoveryRequired) return false;

		// 2. Managed runs have no conversation stream; the durable run state remains authoritative.
		if (run.conversationId === null) return true;

		// 3. Append the fixed safe evidence as the next canonical event in the held transaction.
		const maximum = await this._transaction.conversationRunEvent.aggregate({ where: { runId: run.id }, _max: { sequence: true } });
		await this._transaction.conversationRunEvent.create({ data: { conversationId: run.conversationId, runId: run.id, sequence: (maximum._max.sequence ?? 0) + 1, type: RunEventTypes.ToolRecoveryRequired, payload: { toolInvocationId: event.toolInvocationId, toolCallId: event.toolInvocationId, expectedAttempt: event.expectedAttempt, preparationRetryCount: event.preparationRetryCount, preparationRetryLimit: event.preparationRetryLimit, providerOutcome: event.providerOutcome }, occurredAt: new Date() } });
		return true;
	}
}
