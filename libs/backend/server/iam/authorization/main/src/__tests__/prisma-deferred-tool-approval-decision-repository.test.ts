import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { PrismaDeferredToolApprovalDecisionRepository } from "../prisma-deferred-tool-approval-decision-repository.js";
import { DeferredToolDecisionKinds } from "../deferred-tool-approval.types.js";

/** Exact owner-bound command used to exercise the transaction boundary. */
function _command()
{
	return { approvalRequestId: "approval-1", siloId: "silo-1", subjectId: "user-1", decision: DeferredToolDecisionKinds.Approved, arguments: { query: "approved" }, decidedBy: "user-1", now: new Date("2026-07-27T12:00:00.000Z") };
}

describe("Prisma deferred tool approval decision repository", function _suite()
{
	it("maps a stale authority trigger only after Prisma aborts the transaction", async function _staleAuthority()
	{
		const transaction = vi.fn().mockRejectedValue(new Error("ApprovalRequest decision authority is no longer current"));
		const repository = new PrismaDeferredToolApprovalDecisionRepository({ $transaction: transaction } as unknown as PrismaClient);

		await expect(repository.decideAtomically(_command())).resolves.toEqual({ outcome: "conflict" });
		expect(transaction).toHaveBeenCalledOnce();
	});
});
