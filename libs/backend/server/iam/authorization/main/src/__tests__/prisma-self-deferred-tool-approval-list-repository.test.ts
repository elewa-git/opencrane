import { ApprovalRequestState, type PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { PrismaSelfDeferredToolApprovalListRepository } from "../prisma-self-deferred-tool-approval-list-repository.js";

/** Creates only the actor-safe persisted fields for one deferred tool interrupt. */
function _approvalRow(state: ApprovalRequestState = ApprovalRequestState.Pending)
{
	return { id: "interrupt-1", runId: "run-1", attempt: 2, resourceId: "tool-revision-1", toolInvocation: { toolInvocationId: "call-1" }, state, safeProposedArguments: { query: "safe" }, responseSchema: { oneOf: [] }, expiresAt: new Date("2026-07-26T13:00:00.000Z"), createdAt: new Date("2026-07-26T12:00:00.000Z") };
}

/** Exact actor-facing projection expected from a current pending row. */
function _expected(state = "pending")
{
	return { approvalRequestId: "interrupt-1", runId: "run-1", attempt: 2, toolRevisionId: "tool-revision-1", toolInvocationId: "call-1", state, proposedArguments: { query: "safe" }, responseSchema: { oneOf: [] }, expiresAt: "2026-07-26T13:00:00.000Z", createdAt: "2026-07-26T12:00:00.000Z" };
}

describe("Prisma self deferred tool approval list repository", function _suite()
{
	it("binds the inbox to the exact owner and selects only pre-redacted actor fields", async function _listsPendingOwned()
	{
		const findMany = vi.fn().mockResolvedValue([_approvalRow()]);
		const prisma = { approvalRequest: { findMany } } as unknown as PrismaClient;
		const repository = new PrismaSelfDeferredToolApprovalListRepository(prisma);
		const now = new Date("2026-07-26T12:00:00.000Z");

		await expect(repository.listPendingOwned("silo-1", "user-1", now)).resolves.toEqual([_expected()]);
		expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { siloId: "silo-1", subjectId: "user-1", state: ApprovalRequestState.Pending, expiresAt: { gt: now }, toolInvocationRowId: { not: null } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 50, select: { id: true, runId: true, attempt: true, resourceId: true, state: true, safeProposedArguments: true, responseSchema: true, expiresAt: true, createdAt: true, toolInvocation: { select: { toolInvocationId: true } } } }));
		expect(JSON.stringify(findMany.mock.calls)).not.toContain("reviewedToolArguments");
		expect(JSON.stringify(findMany.mock.calls)).not.toContain("finalArguments");
		expect(JSON.stringify(findMany.mock.calls)).not.toContain("resumeTokenHash");
	});

	it("reads one exact owner-bound interrupt and reports its durable state", async function _readsOwned()
	{
		const findFirst = vi.fn().mockResolvedValue(_approvalRow(ApprovalRequestState.Approved));
		const repository = new PrismaSelfDeferredToolApprovalListRepository({ approvalRequest: { findFirst } } as unknown as PrismaClient);

		await expect(repository.readOwned("interrupt-1", "silo-1", "user-1", new Date("2026-07-26T12:00:00.000Z"))).resolves.toEqual(_expected("approved"));
		expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "interrupt-1", siloId: "silo-1", subjectId: "user-1", toolInvocationRowId: { not: null } } }));
	});

	it("derives an overdue still-pending row as expired without widening the query", async function _derivesExpiry()
	{
		const repository = new PrismaSelfDeferredToolApprovalListRepository({ approvalRequest: { findFirst: vi.fn().mockResolvedValue(_approvalRow()) } } as unknown as PrismaClient);
		await expect(repository.readOwned("interrupt-1", "silo-1", "user-1", new Date("2026-07-26T14:00:00.000Z"))).resolves.toEqual(_expected("expired"));
	});
});
