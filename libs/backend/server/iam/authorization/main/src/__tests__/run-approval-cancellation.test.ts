import { ActionExecutionState, ApprovalRequestState, type Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { __CancelPendingRunApprovalAuthority } from "../run-approval-cancellation.js";

describe("run approval cancellation authority", function _suite()
{
	it("cancels only pending approvals for the exact run attempt on the supplied transaction", async function _cancelPendingApprovals()
	{
		const updateMany = vi.fn().mockResolvedValue({ count: 2 });
		const failInvocations = vi.fn().mockResolvedValue({ count: 2 });
		const transaction = { approvalRequest: { findMany: vi.fn().mockResolvedValue([{ toolInvocationRowId: "invocation-1" }, { toolInvocationRowId: "invocation-2" }]), updateMany }, toolInvocation: { updateMany: failInvocations } } as unknown as Prisma.TransactionClient;
		const now = new Date("2026-07-21T08:00:00.000Z");

		await expect(__CancelPendingRunApprovalAuthority(transaction, { runId: "run-1", attempt: 3, now })).resolves.toEqual({ cancelledCount: 2, failedInvocationCount: 2 });
		expect(updateMany).toHaveBeenCalledWith({
			where: { runId: "run-1", attempt: 3, state: ApprovalRequestState.Pending },
			data: { state: ApprovalRequestState.Cancelled, decidedAt: now, decidedBy: null, resumeTokenHash: null },
		});
		expect(failInvocations).toHaveBeenCalledWith({ where: { id: { in: ["invocation-1", "invocation-2"] }, runId: "run-1", attempt: 3, state: ActionExecutionState.Reserved }, data: { state: ActionExecutionState.Failed, failureCode: "approval_cancelled", completedAt: now } });
	});

	it("is idempotent after no pending approval authority remains", async function _returnZeroAfterCancellation()
	{
		const updateMany = vi.fn().mockResolvedValue({ count: 0 });
		const transaction = { approvalRequest: { findMany: vi.fn().mockResolvedValue([]), updateMany }, toolInvocation: { updateMany: vi.fn() } } as unknown as Prisma.TransactionClient;

		await expect(__CancelPendingRunApprovalAuthority(transaction, { runId: "run-1", attempt: 3, now: new Date("2026-07-21T08:00:00.000Z") })).resolves.toEqual({ cancelledCount: 0, failedInvocationCount: 0 });
	});
});
