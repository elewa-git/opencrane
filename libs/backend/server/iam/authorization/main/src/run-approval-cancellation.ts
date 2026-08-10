import { ActionExecutionState, ApprovalRequestState, type Prisma } from "@prisma/client";

import type { CancelPendingRunApprovalAuthorityCommand, CancelPendingRunApprovalAuthorityResult } from "./run-approval-cancellation.types.js";

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
	// 1. Snapshot invocation links before terminalising their pending approval rows.
	const pending = await transaction.approvalRequest.findMany({ where: { runId: command.runId, attempt: command.attempt, state: ApprovalRequestState.Pending }, select: { toolInvocationRowId: true } });
	const invocationIds = pending.flatMap(function _linked(row) { return row.toolInvocationRowId === null ? [] : [row.toolInvocationRowId]; });

	// 2. Close every pending approval without a resume marker; cancellation never resumes the run.
	const cancelled = await transaction.approvalRequest.updateMany({
		where: { runId: command.runId, attempt: command.attempt, state: ApprovalRequestState.Pending },
		data: { state: ApprovalRequestState.Cancelled, decidedAt: command.now, decidedBy: null, resumeTokenHash: null },
	});

	// 3. Terminalise only still-reserved linked actions so no cancelled side effect remains replayable.
	if (invocationIds.length === 0) return { cancelledCount: cancelled.count, failedInvocationCount: 0 };
	const failed = await transaction.toolInvocation.updateMany({ where: { id: { in: invocationIds }, runId: command.runId, attempt: command.attempt, state: ActionExecutionState.Reserved }, data: { state: ActionExecutionState.Failed, failureCode: "approval_cancelled", completedAt: command.now } });
	return { cancelledCount: cancelled.count, failedInvocationCount: failed.count };
}
