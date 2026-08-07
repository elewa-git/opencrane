import { ApprovalRequestState, type PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { PrismaSelfDeferredToolApprovalListRepository } from "../prisma-self-deferred-tool-approval-list-repository.js";

/** Creates the selected persisted fields for one pending deferred tool approval. */
function _approvalRow()
{
	return { id: "approval-1", runId: "run-1", attempt: 2, resourceId: "tool-revision-1", expiresAt: new Date("2026-07-26T13:00:00.000Z"), createdAt: new Date("2026-07-26T12:00:00.000Z") };
}

describe("Prisma self deferred tool approval list repository", function _suite()
{
	it("binds the pending inbox to the exact owner and silo without selecting sensitive approval data", async function _listsPendingOwned()
	{
		const findMany = vi.fn().mockResolvedValue([_approvalRow()]);
		const prisma = { approvalRequest: { findMany } } as unknown as PrismaClient;
		const repository = new PrismaSelfDeferredToolApprovalListRepository(prisma);

		const now = new Date("2026-07-26T12:00:00.000Z");
		await expect(repository.listPendingOwned("silo-1", "user-1", now)).resolves.toEqual([{ approvalRequestId: "approval-1", runId: "run-1", attempt: 2, toolRevisionId: "tool-revision-1", expiresAt: "2026-07-26T13:00:00.000Z", createdAt: "2026-07-26T12:00:00.000Z" }]);
		expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { siloId: "silo-1", subjectId: "user-1", state: ApprovalRequestState.Pending, expiresAt: { gt: now }, toolInvocationRowId: { not: null } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 50, select: { id: true, runId: true, attempt: true, resourceId: true, expiresAt: true, createdAt: true } }));
	});
});
