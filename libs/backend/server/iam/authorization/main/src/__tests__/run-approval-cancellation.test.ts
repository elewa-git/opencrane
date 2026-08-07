import { ApprovalRequestState, type Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { __CancelPendingRunApprovalAuthority } from "../run-approval-cancellation.js";

describe("run approval cancellation authority", function _suite()
{
	it("cancels only pending approvals for the exact run attempt on the supplied transaction", async function _cancelPendingApprovals()
	{
		const updateMany = vi.fn().mockResolvedValue({ count: 2 });
		const transaction = { approvalRequest: { updateMany } } as unknown as Prisma.TransactionClient;
		const now = new Date("2026-07-21T08:00:00.000Z");

		await expect(__CancelPendingRunApprovalAuthority(transaction, { runId: "run-1", attempt: 3, now })).resolves.toEqual({ cancelledCount: 2 });
		expect(updateMany).toHaveBeenCalledWith({
			where: { runId: "run-1", attempt: 3, state: ApprovalRequestState.Pending },
			data: { state: ApprovalRequestState.Cancelled, decidedAt: now, decidedBy: null, resumeTokenHash: null },
		});
	});

	it("is idempotent after no pending approval authority remains", async function _returnZeroAfterCancellation()
	{
		const updateMany = vi.fn().mockResolvedValue({ count: 0 });
		const transaction = { approvalRequest: { updateMany } } as unknown as Prisma.TransactionClient;

		await expect(__CancelPendingRunApprovalAuthority(transaction, { runId: "run-1", attempt: 3, now: new Date("2026-07-21T08:00:00.000Z") })).resolves.toEqual({ cancelledCount: 0 });
	});
});
