import { ApprovalRequestState, type Prisma } from "@prisma/client";

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
	const cancelled = await transaction.approvalRequest.updateMany({
		where: { runId: command.runId, attempt: command.attempt, state: ApprovalRequestState.Pending },
		data: { state: ApprovalRequestState.Cancelled, decidedAt: command.now, decidedBy: null, resumeTokenHash: null },
	});
	return { cancelledCount: cancelled.count };
}
