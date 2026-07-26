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

	/** Read only the exact run owned by the session subject in the selected silo. */
	async readOwned(runId: string, siloId: string, subjectId: string): Promise<SelfRunStatus | null>
	{
		const run = await this._prisma.agentRun.findFirst({ where: { id: runId, siloId, delegatedUserId: subjectId }, select: { id: true, attempt: true, state: true, threadId: true, agentRevisionId: true, acceptedAt: true, finishedAt: true } });
		return run === null ? null : { runId: run.id, attempt: run.attempt, state: _state(run.state.toString()), threadId: run.threadId, agentRevisionId: run.agentRevisionId, acceptedAt: run.acceptedAt.toISOString(), finishedAt: run.finishedAt?.toISOString() ?? null };
	}
}

/** Map Prisma's PascalCase lifecycle enum to the product API's stable lowercase spelling. */
function _state(value: string): string
{
	if (value === "WaitingForApproval") return "waiting_for_approval";
	return value.replace(/([a-z])([A-Z])/gu, "$1_$2").toLowerCase();
}
