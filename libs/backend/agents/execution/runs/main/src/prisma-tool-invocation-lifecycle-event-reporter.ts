import { AgentRunState, type Prisma, type PrismaClient } from "@prisma/client";

import { ToolInvocationEventTypes, type ToolInvocationLifecycleEvent } from "@opencrane/backend/server/iam/authorization";

import type { ToolInvocationLifecycleEventAppendRepository, ToolInvocationLifecycleEventAppendUnitOfWork, ToolInvocationLifecycleEventUnitOfWork } from "./tool-invocation-lifecycle-event-reporter.types";

/** Process-scoped transaction owner shared by the worker and its invocation unit of work. */
export class PrismaToolInvocationLifecycleEventUnitOfWork implements ToolInvocationLifecycleEventUnitOfWork
{
	/** Create one reporter and optional same-transaction notification hook. */
	constructor(private readonly prisma: PrismaClient, private readonly afterAppendInTransaction?: (transaction: Prisma.TransactionClient, event: ToolInvocationLifecycleEvent) => Promise<void>)
	{
	}

	/** Check a pre-dispatch event against the run fence in its own transaction or fail closed. */
	async append(event: ToolInvocationLifecycleEvent): Promise<void>
	{
		const afterAppend = this.afterAppendInTransaction;
		const appended = await this.prisma.$transaction(async function _append(transaction)
		{
			const unitOfWork = new PrismaToolInvocationLifecycleEventAppendUnitOfWork(transaction);
			const accepted = await unitOfWork.append(event);
			if (accepted && afterAppend !== undefined)
				await afterAppend(transaction, event);
			return accepted;
		});
		if (!appended)
		{
			throw new Error("tool lifecycle event is no longer valid for the run attempt");
		}
	}

	/** Check the event against the run fence within the invocation owner's exact state transaction. */
	async appendInTransaction(transaction: unknown, event: ToolInvocationLifecycleEvent): Promise<boolean>
	{
		const client = transaction as Prisma.TransactionClient;
		const unitOfWork = new PrismaToolInvocationLifecycleEventAppendUnitOfWork(client);
		const accepted = await unitOfWork.append(event);
		if (accepted && this.afterAppendInTransaction !== undefined)
			await this.afterAppendInTransaction(client, event);
		return accepted;
	}
}

/** Transaction owner for one tool lifecycle event fence check. */
class PrismaToolInvocationLifecycleEventAppendUnitOfWork implements ToolInvocationLifecycleEventAppendUnitOfWork
{
	/** Exact invocation transition transaction. */
	private readonly transaction: Prisma.TransactionClient;

	/** Bind repository construction to the caller's invocation transaction. */
	constructor(transaction: Prisma.TransactionClient)
	{
		this.transaction = transaction;
	}

	/** Check the event through the transaction-bound repository. */
	append(event: ToolInvocationLifecycleEvent): Promise<boolean>
	{
		const repository = new PrismaToolInvocationLifecycleEventAppendRepository(this.transaction);
		return repository.append(event);
	}
}

/**
 * Checks that a tool lifecycle event still belongs to the current run attempt.
 *
 * Nothing is written here: participant-visible tool history lives in the KurrentDB conversation
 * stream, which the conversation computer appends. This repository only tells the worker whether
 * the run fence still admits the event.
 */
class PrismaToolInvocationLifecycleEventAppendRepository implements ToolInvocationLifecycleEventAppendRepository
{
	/** Exact invocation transition transaction. */
	private readonly transaction: Prisma.TransactionClient;

	/** Bind all reads and writes to the invocation transaction. */
	constructor(transaction: Prisma.TransactionClient)
	{
		this.transaction = transaction;
	}

	/** Validate the safe payload and recheck the run fence; true means the event is still admissible. */
	async append(event: ToolInvocationLifecycleEvent): Promise<boolean>
	{
		if (!_EventIsSafe(event))
		{
			return false;
		}
		const run = await this.transaction.agentRun.findUnique({ where: { id: event.runId } });
		return run !== null && run.attempt === event.attempt && _EventAllowedForRun(run.state, event.eventType);
	}
}

/** Allow lifecycle evidence only while the current run can still progress. */
function _EventAllowedForRun(state: AgentRunState, eventType: ToolInvocationEventTypes): boolean
{
	return (state === AgentRunState.Running || state === AgentRunState.RecoveryRequired) && eventType !== undefined;
}

/** Enforce the fixed credential-free event shape even for an incorrectly wired internal caller. */
function _EventIsSafe(event: ToolInvocationLifecycleEvent): boolean
{
	if (event.runId.length === 0 || event.runId.length > 256 || !Number.isSafeInteger(event.attempt) || event.attempt < 1 || event.payload.toolInvocationId.length === 0 || event.payload.toolInvocationId.length > 256)
	{
		return false;
	}
	if (event.eventType !== ToolInvocationEventTypes.Failed)
	{
		return true;
	}
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
