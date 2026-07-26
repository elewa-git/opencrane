import { ApprovalRequestState, type PrismaClient } from "@prisma/client";

import type { SelfDeferredToolApproval, SelfDeferredToolApprovalListRepository } from "./deferred-tool-approval.types.js";

/** Prisma reader for the signed-in owner's bounded pending-tool-approval inbox. */
export class PrismaSelfDeferredToolApprovalListRepository implements SelfDeferredToolApprovalListRepository
{
	/** Canonical product authority used for owner-bound approval reads. */
	private readonly _prisma: PrismaClient;

	/** Construct the pending-approval reader around the server-owned Prisma client. */
	constructor(prisma: PrismaClient)
	{
		this._prisma = prisma;
	}

	/** List the latest fifty still-pending deferred tool approvals for one exact owner and silo. */
	async listPendingOwned(siloId: string, subjectId: string, now: Date): Promise<readonly SelfDeferredToolApproval[]>
	{
		const approvals = await this._prisma.approvalRequest.findMany({ where: { siloId, subjectId, state: ApprovalRequestState.Pending, expiresAt: { gt: now }, toolInvocationRowId: { not: null } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 50, select: { id: true, runId: true, attempt: true, resourceId: true, expiresAt: true, createdAt: true } });
		return approvals.map(_toSelfDeferredToolApproval);
	}
}

/** Map selected durable approval fields to the non-sensitive product inbox shape. */
function _toSelfDeferredToolApproval(approval: { id: string; runId: string; attempt: number; resourceId: string; expiresAt: Date; createdAt: Date }): SelfDeferredToolApproval
{
	return { approvalRequestId: approval.id, runId: approval.runId, attempt: approval.attempt, toolRevisionId: approval.resourceId, expiresAt: approval.expiresAt.toISOString(), createdAt: approval.createdAt.toISOString() };
}
