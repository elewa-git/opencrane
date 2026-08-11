import { ActionExecutionState, ApprovalRequestState, type Prisma } from "@prisma/client";

import type { CancelPendingRunApprovalAuthorityCommand, CancelPendingRunApprovalAuthorityResult, RunApprovalCancellationRepository, RunApprovalCancellationUnitOfWork } from "./run-approval-cancellation.types.js";

/** Prisma cancellation repository bound to the caller-owned run transaction. */
export class PrismaRunApprovalCancellationRepository implements RunApprovalCancellationRepository
{
	/** Exact cancellation transaction. */
	private readonly _transaction: Prisma.TransactionClient;

	/** Bind approval and invocation writes to the run cancellation transaction. */
	constructor(transaction: Prisma.TransactionClient)
	{
		this._transaction = transaction;
	}

	/** Snapshot linked pending invocation ids. */
	async findPendingInvocationIds(runId: string, attempt: number): Promise<readonly string[]>
	{
		const pending = await this._transaction.approvalRequest.findMany({ where: { runId, attempt, state: ApprovalRequestState.Pending }, select: { toolInvocationRowId: true } });
		return pending.flatMap(function _Linked(row) { return row.toolInvocationRowId === null ? [] : [row.toolInvocationRowId]; });
	}

	/** Close pending approvals without resume authority. */
	async cancelPending(runId: string, attempt: number, now: Date): Promise<number>
	{
		const cancelled = await this._transaction.approvalRequest.updateMany({ where: { runId, attempt, state: ApprovalRequestState.Pending }, data: { state: ApprovalRequestState.Cancelled, decidedAt: now, decidedBy: null, resumeTokenHash: null } });
		return cancelled.count;
	}

	/** Fail linked actions only while they remain reserved. */
	async failReserved(invocationIds: readonly string[], runId: string, attempt: number, now: Date): Promise<number>
	{
		const failed = await this._transaction.toolInvocation.updateMany({ where: { id: { in: [...invocationIds] }, runId, attempt, state: ActionExecutionState.Reserved }, data: { state: ActionExecutionState.Failed, failureCode: "approval_cancelled", completedAt: now } });
		return failed.count;
	}
}

/**
 * Cancels pending approval authority inside a caller-owned run cancellation transaction.
 * Decided approvals remain immutable; only Pending rows for the exact run attempt are closed, and
 * their resume-token hashes are cleared so no late approval can resume cancelled work.
 * @param transaction - Prisma transaction already holding the owning run cancellation fence.
 * @param command - Exact run attempt and trusted cancellation instant.
 * @returns The number of Pending approvals transitioned to Cancelled.
 */
export async function __CancelPendingRunApprovalAuthority(transaction: Prisma.TransactionClient, command: CancelPendingRunApprovalAuthorityCommand): Promise<CancelPendingRunApprovalAuthorityResult>
{
	return new PrismaRunApprovalCancellationUnitOfWork(transaction).cancel(command);
}

/** Transaction-scoped unit that owns construction of the cancellation repository. */
class PrismaRunApprovalCancellationUnitOfWork implements RunApprovalCancellationUnitOfWork
{
	/** Exact cancellation transaction. */
	private readonly _transaction: Prisma.TransactionClient;

	/** Bind repository construction to the caller-owned transaction. */
	constructor(transaction: Prisma.TransactionClient)
	{
		this._transaction = transaction;
	}

	/** Close approval and invocation authority without exposing delegates to the caller. */
	async cancel(command: CancelPendingRunApprovalAuthorityCommand): Promise<CancelPendingRunApprovalAuthorityResult>
	{
		const repository = new PrismaRunApprovalCancellationRepository(this._transaction);
	// 1. Snapshot invocation links before terminalising their pending approval rows.
	const invocationIds = await repository.findPendingInvocationIds(command.runId, command.attempt);

	// 2. Close every pending approval without a resume marker; cancellation never resumes the run.
	const cancelledCount = await repository.cancelPending(command.runId, command.attempt, command.now);

	// 3. Terminalise only still-reserved linked actions so no cancelled side effect remains replayable.
	if (invocationIds.length === 0) return { cancelledCount, failedInvocationCount: 0 };
	const failedInvocationCount = await repository.failReserved(invocationIds, command.runId, command.attempt, command.now);
	return { cancelledCount, failedInvocationCount };
	}
}
