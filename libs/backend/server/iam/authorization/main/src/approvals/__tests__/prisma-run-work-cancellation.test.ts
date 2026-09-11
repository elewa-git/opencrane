import { AgentRunState, ToolInvocationState } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { PrismaRunWorkCancellationRepository } from "../prisma-run-work-cancellation";

describe("Prisma run work cancellation", function _Suite()
{
	it("closes interaction while selecting only provider-free invocation states", async function _ClosesProviderFreeWork()
	{
		const findMany = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([]);
		const aggregate = vi.fn().mockResolvedValue({ _count: { _all: 0 }, _min: { claimExpiresAt: null } });
		const transaction = { toolInvocation: { findMany, aggregate }, elicitationRequest: { updateMany: vi.fn().mockResolvedValue({ count: 2 }) }, approvalRequest: { findMany: vi.fn().mockResolvedValue([]) } };
		const result = await new PrismaRunWorkCancellationRepository(transaction as never).cancel({ runId: "run-1", attempt: 2, now: new Date("2026-09-11T10:00:00.000Z") });
		expect(result).toEqual({ cancelledApprovalCount: 0, cancelledElicitationCount: 2, failedInvocationCount: 0, activeClaimCount: 0, nextClaimExpiryAt: null });
		expect(findMany).toHaveBeenNthCalledWith(2, expect.objectContaining({ where: expect.objectContaining({ state: { in: [ToolInvocationState.Preparing, ToolInvocationState.AwaitingApproval, ToolInvocationState.Ready] }, claimKind: null, run: { state: AgentRunState.Cancelling } }) }));
	});

	it("retains active provider claims and reports their earliest saved expiry", async function _RetainsClaims()
	{
		const expiry = new Date("2026-09-11T10:01:00.000Z");
		const transaction = { toolInvocation: { findMany: vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([]), aggregate: vi.fn().mockResolvedValue({ _count: { _all: 1 }, _min: { claimExpiresAt: expiry } }) }, elicitationRequest: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) }, approvalRequest: { findMany: vi.fn().mockResolvedValue([]) } };
		await expect(new PrismaRunWorkCancellationRepository(transaction as never).cancel({ runId: "run-1", attempt: 2, now: new Date("2026-09-11T10:00:00.000Z") })).resolves.toMatchObject({ activeClaimCount: 1, nextClaimExpiryAt: expiry });
		expect(transaction.toolInvocation.aggregate).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ state: { in: [ToolInvocationState.Claimed, ToolInvocationState.Reconciling] }, claimKind: { not: null }, run: { state: AgentRunState.Cancelling } }) }));
	});

});
