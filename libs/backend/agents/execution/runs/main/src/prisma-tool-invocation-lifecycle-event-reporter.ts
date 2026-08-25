import { AgentRunState, Prisma, type PrismaClient } from "@prisma/client";

import { ToolInvocationEventTypes, type ToolInvocationLifecycleEvent } from "@opencrane/backend/server/iam/authorization";

import type { ToolInvocationLifecycleEventAppendRepository, ToolInvocationLifecycleEventAppendUnitOfWork, ToolInvocationLifecycleEventUnitOfWork } from "./tool-invocation-lifecycle-event-reporter.types";

/** Process-scoped transaction owner shared by the worker and its invocation unit of work. */
export class PrismaToolInvocationLifecycleEventUnitOfWork implements ToolInvocationLifecycleEventUnitOfWork
{
	/** Canonical product-authority database client. */
	private readonly prisma: PrismaClient;

	/** Create one reporter over process-owned persistence. */
	constructor(prisma: PrismaClient)
	{
		this.prisma = prisma;
	}

	/** Append a pre-dispatch event in its own transaction or fail closed. */
	async append(event: ToolInvocationLifecycleEvent): Promise<void>
	{
		const appended = await this.prisma.$transaction(async function _append(transaction)
		{
			const unitOfWork = new PrismaToolInvocationLifecycleEventAppendUnitOfWork(transaction);
			return unitOfWork.append(event);
		});
		if (!appended) throw new Error("tool lifecycle event is no longer valid for the run attempt");
	}

	/** Append within the invocation owner's exact state transaction. */
	async appendInTransaction(transaction: unknown, event: ToolInvocationLifecycleEvent): Promise<boolean>
	{
		const unitOfWork = new PrismaToolInvocationLifecycleEventAppendUnitOfWork(transaction as Prisma.TransactionClient);
		return unitOfWork.append(event);
	}
}

/** Transaction owner for one tool lifecycle event append. */
class PrismaToolInvocationLifecycleEventAppendUnitOfWork implements ToolInvocationLifecycleEventAppendUnitOfWork
{
	/** Exact invocation transition transaction. */
	private readonly transaction: Prisma.TransactionClient;

	/** Bind repository construction to the caller's invocation transaction. */
	constructor(transaction: Prisma.TransactionClient)
	{
		this.transaction = transaction;
	}

	/** Append through the transaction-bound repository. */
	append(event: ToolInvocationLifecycleEvent): Promise<boolean>
	{
		const repository = new PrismaToolInvocationLifecycleEventAppendRepository(this.transaction);
		return repository.append(event);
	}
}

/** Canonical run-event repository for server-owned tool lifecycle evidence. */
class PrismaToolInvocationLifecycleEventAppendRepository implements ToolInvocationLifecycleEventAppendRepository
{
	/** Exact invocation transition transaction. */
	private readonly transaction: Prisma.TransactionClient;

	/** Bind all reads and writes to the invocation transaction. */
	constructor(transaction: Prisma.TransactionClient)
	{
		this.transaction = transaction;
	}

	/** Recheck the run fence, validate the safe payload, and append the next event. */
	async append(event: ToolInvocationLifecycleEvent): Promise<boolean>
	{
		if (!_EventIsSafe(event)) return false;
		const run = await this.transaction.agentRun.findUnique({ where: { id: event.runId } });
		if (run === null || run.attempt !== event.attempt || !_EventAllowedForRun(run.state, event.eventType)) return false;
		if (run.conversationId === null) return true;
		const maximum = await this.transaction.conversationRunEvent.aggregate({ where: { runId: run.id }, _max: { sequence: true } });
		await this.transaction.conversationRunEvent.create({ data: { conversationId: run.conversationId, runId: run.id, sequence: (maximum._max.sequence ?? 0) + 1, type: event.eventType, payload: event.payload as Prisma.InputJsonValue, occurredAt: new Date() } });
		return true;
	}
}

/** Allow cancellation-safe settlement evidence without admitting any new provider operation. */
function _EventAllowedForRun(state: AgentRunState, eventType: ToolInvocationEventTypes): boolean
{
	if (state === AgentRunState.Running || state === AgentRunState.RecoveryRequired) return true;
	if (state !== AgentRunState.Cancelling) return false;
	return eventType === ToolInvocationEventTypes.Completed || eventType === ToolInvocationEventTypes.Failed;
}

/** Enforce the fixed credential-free event shape even for an incorrectly wired internal caller. */
function _EventIsSafe(event: ToolInvocationLifecycleEvent): boolean
{
	if (event.runId.length === 0 || event.runId.length > 256 || !Number.isSafeInteger(event.attempt) || event.attempt < 1 || event.payload.toolInvocationId.length === 0 || event.payload.toolInvocationId.length > 256) return false;
	if (event.eventType !== ToolInvocationEventTypes.Failed) return true;
	return event.payload.toolRevisionId.length > 0
		&& event.payload.toolRevisionId.length <= 256
		&& event.payload.reason.length > 0
		&& event.payload.reason.length <= 128
		&& /^[a-zA-Z0-9_.-]+$/u.test(event.payload.reason)
		&& Number.isSafeInteger(event.payload.retryCount)
		&& event.payload.retryCount >= 0
		&& event.payload.retryCount <= event.payload.retryLimit
		&& event.payload.retryLimit === 3
		&& typeof event.payload.retrying === "boolean";
}
