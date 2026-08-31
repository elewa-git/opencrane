import { AgentRunState, ApprovalRequestState, ExternalActionRecoveryMode, ToolInvocationState, type Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

const _reconcileApprovalGrants = vi.hoisted(function _ReconcileApprovalGrants() { return vi.fn().mockResolvedValue(undefined); });
vi.mock("../deferred-tool-approval", function _MockDeferredApproval() { return { __ReconcileDeferredToolApprovalGrants: _reconcileApprovalGrants }; });

import { __CancelPendingRunApprovalAuthority } from "../run-approval-cancellation";

describe("run approval cancellation authority", function _suite()
{
	it("cancels approvals and only provider-free or unclaimed invocations for the exact attempt", async function _cancelPendingApprovals()
	{
		const updateApprovals = vi.fn().mockResolvedValue({ count: 1 });
		const failInvocations = vi.fn().mockResolvedValue({ count: 1 });
		const createDeliveries = vi.fn().mockResolvedValue({ count: 2 });
		const retryDeadlineAt = new Date("2026-07-21T08:05:00.000Z");
		const invocations = [
			{ id: "invocation-1", toolInvocationId: "call-1", state: ToolInvocationState.Preparing, recoveryMode: ExternalActionRecoveryMode.Manual, claimKind: null, preparationAttempt: 1, retryDeadlineAt, revision: 2 },
			{ id: "invocation-2", toolInvocationId: "call-2", state: ToolInvocationState.Reconciling, recoveryMode: ExternalActionRecoveryMode.Reconciliation, claimKind: null, preparationAttempt: 1, retryDeadlineAt, revision: 4 },
		];
		const transaction = { elicitationRequest: { updateMany: vi.fn().mockResolvedValue({ count: 2 }) }, approvalRequest: { findMany: vi.fn().mockResolvedValue([{ id: "approval-1", siloId: "silo-1" }, { id: "approval-2", siloId: "silo-1" }]), updateMany: updateApprovals }, toolInvocation: { findMany: vi.fn().mockResolvedValue(invocations), updateMany: failInvocations, count: vi.fn().mockResolvedValue(1) }, toolResultDelivery: { createMany: createDeliveries } } as unknown as Prisma.TransactionClient;
		const now = new Date("2026-07-21T08:00:00.000Z");

		await expect(__CancelPendingRunApprovalAuthority(transaction, { runId: "run-1", attempt: 3, now })).resolves.toEqual({ cancelledCount: 2, failedInvocationCount: 2, activeClaimCount: 1 });
		expect(updateApprovals).toHaveBeenNthCalledWith(1, { where: { id: "approval-1", runId: "run-1", attempt: 3, state: ApprovalRequestState.Pending }, data: { state: ApprovalRequestState.Cancelled, decidedAt: now, decidedBy: null } });
		expect(updateApprovals).toHaveBeenNthCalledWith(2, { where: { id: "approval-2", runId: "run-1", attempt: 3, state: ApprovalRequestState.Pending }, data: { state: ApprovalRequestState.Cancelled, decidedAt: now, decidedBy: null } });
		expect(_reconcileApprovalGrants).toHaveBeenCalledTimes(2);
		expect(transaction.elicitationRequest.updateMany).toHaveBeenCalledWith({ where: { runId: "run-1", attempt: 3, state: "Requested" }, data: { state: "Cancelled", resolvedAt: now, resolvedBy: null, safeReason: "run_cancelled" } });
		expect(transaction.toolInvocation.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ claimKind: null, state: { in: expect.not.arrayContaining([ToolInvocationState.Claimed]) } }) }));
		expect(failInvocations).toHaveBeenNthCalledWith(1, expect.objectContaining({ where: expect.objectContaining({ id: "invocation-1", state: ToolInvocationState.Preparing, revision: 2, claimKind: null, run: { is: { attempt: 3, state: AgentRunState.Cancelling } } }), data: expect.objectContaining({ state: ToolInvocationState.Failed, failureCode: "run_cancelled" }) }));
		expect(failInvocations).toHaveBeenNthCalledWith(2, expect.objectContaining({ where: expect.objectContaining({ id: "invocation-2", state: ToolInvocationState.Reconciling, revision: 4, claimKind: null, run: { is: { attempt: 3, state: AgentRunState.Cancelling } } }), data: expect.objectContaining({ state: ToolInvocationState.Failed, failureCode: "run_cancelled" }) }));
		expect(transaction.toolInvocation.count).toHaveBeenCalledWith({ where: { runId: "run-1", attempt: 3, state: { in: [ToolInvocationState.Claimed, ToolInvocationState.Reconciling] }, claimKind: { not: null }, run: { is: { attempt: 3, state: AgentRunState.Cancelling } } } });
		expect(createDeliveries).toHaveBeenCalledWith({ data: [expect.objectContaining({ toolInvocationId: "invocation-1", payload: { toolInvocationId: "call-1", outcome: "failed", failureCode: "run_cancelled" } }), expect.objectContaining({ toolInvocationId: "invocation-2", payload: { toolInvocationId: "call-2", outcome: "failed", failureCode: "run_cancelled" } })] });
	});

	it("is idempotent after no pending invocation authority remains", async function _returnZeroAfterCancellation()
	{
		const updateApprovals = vi.fn().mockResolvedValue({ count: 0 });
		const transaction = { elicitationRequest: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) }, approvalRequest: { findMany: vi.fn().mockResolvedValue([]), updateMany: updateApprovals }, toolInvocation: { findMany: vi.fn().mockResolvedValue([]), updateMany: vi.fn(), count: vi.fn().mockResolvedValue(0) }, toolResultDelivery: { createMany: vi.fn() } } as unknown as Prisma.TransactionClient;

		await expect(__CancelPendingRunApprovalAuthority(transaction, { runId: "run-1", attempt: 3, now: new Date("2026-07-21T08:00:00.000Z") })).resolves.toEqual({ cancelledCount: 0, failedInvocationCount: 0, activeClaimCount: 0 });
		expect(transaction.toolResultDelivery.createMany).not.toHaveBeenCalled();
	});
});
