import type { PrismaClient } from "@prisma/client";

import type { SelfRunStatus, SelfRunStatusRepository } from "./self-run-status.router.types.js";

/** Prisma read adapter for the product owner's immutable run-status view. */
export class PrismaSelfRunStatusRepository implements SelfRunStatusRepository
{
	/** Canonical product database client. */
	private readonly _prisma: PrismaClient;

	/** Construct the owner-bound status reader around the app-owned Prisma client. */
	constructor(prisma: PrismaClient)
	{
		this._prisma = prisma;
	}

	/** List the latest fifty personal runs owned by one session subject in one silo. */
	async listOwned(siloId: string, subjectId: string): Promise<readonly SelfRunStatus[]>
	{
		const runs = await this._prisma.agentRun.findMany({ where: { siloId, delegatedUserId: subjectId }, orderBy: [{ acceptedAt: "desc" }, { id: "desc" }], take: 50, select: { id: true, attempt: true, state: true, threadId: true, agentRevisionId: true, acceptedAt: true, finishedAt: true } });
		return runs.map(_toSelfRunStatus);
	}

	/** Read only the exact run owned by the session subject in the selected silo. */
	async readOwned(runId: string, siloId: string, subjectId: string): Promise<SelfRunStatus | null>
	{
		const run = await this._prisma.agentRun.findFirst({ where: { id: runId, siloId, delegatedUserId: subjectId }, select: { id: true, attempt: true, state: true, threadId: true, agentRevisionId: true, acceptedAt: true, finishedAt: true } });
		return run === null ? null : _toSelfRunStatus(run);
	}
}

/** Convert the selected canonical Prisma fields into the stable product status shape. */
function _toSelfRunStatus(run: { id: string; attempt: number; state: { toString(): string }; threadId: string | null; agentRevisionId: string; acceptedAt: Date; finishedAt: Date | null }): SelfRunStatus
{
	return { runId: run.id, attempt: run.attempt, state: _state(run.state.toString()), threadId: run.threadId, agentRevisionId: run.agentRevisionId, acceptedAt: run.acceptedAt.toISOString(), finishedAt: run.finishedAt?.toISOString() ?? null };
}

/** Map Prisma's PascalCase lifecycle enum to the product API's stable lowercase spelling. */
function _state(value: string): string
{
	if (value === "WaitingForApproval") return "waiting_for_approval";
	return value.replace(/([a-z])([A-Z])/gu, "$1_$2").toLowerCase();
}
