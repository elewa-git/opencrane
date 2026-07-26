import { Prisma, SkillWorkloadState, type PrismaClient } from "@prisma/client";

import type { SkillAuthoringCompletionCommand, SkillAuthoringCompletionRepository } from "./skill-authoring-completion.types.js";
import type { SkillWorkloadBootstrapIdentity } from "./skill-workload-bootstrap.types.js";

/** Prisma authority for one exact authoring worker's terminal evidence report. */
export class PrismaSkillAuthoringCompletionRepository implements SkillAuthoringCompletionRepository
{
	/** Canonical OpenCrane product-authority database client. */
	private readonly prisma: PrismaClient;

	/** Creates the authoring completion authority over canonical Postgres. */
	constructor(prisma: PrismaClient)
	{
		this.prisma = prisma;
	}

	/** Completes one bootstrap-consumed Draft authoring workload and persists only bounded evidence. */
	async completeAtomically(command: SkillAuthoringCompletionCommand, identity: SkillWorkloadBootstrapIdentity): Promise<"completed" | "conflict">
	{
		return this.prisma.$transaction(async function _Complete(transaction: Prisma.TransactionClient): Promise<"completed" | "conflict">
		{
			// 1. Lock the workload so a duplicate report cannot alter its revision after a competing completion.
			const locked = await transaction.$queryRaw<readonly { readonly id: string }[]>(Prisma.sql`SELECT "id" FROM "skill_workloads" WHERE "id" = ${command.workloadId} FOR UPDATE`);
			if (locked.length !== 1) return "conflict";

			// 2. Fence against the exact canonical worker Pod and consumed bootstrap before any revision evidence changes.
			const workload = await transaction.skillWorkload.findFirst({ where: { id: command.workloadId, kind: "Authoring", state: SkillWorkloadState.Assigned, releasedAt: { not: null }, workerPodUid: identity.podUid, bootstrap: { is: { consumedAt: { not: null }, consumedByPodUid: identity.podUid, namespace: identity.namespace, serviceAccountName: identity.serviceAccountName } } }, include: { skillRevision: true } });
			if (workload === null || workload.skillRevision.state !== "Draft") return "conflict";

			// 3. Store passed reports before terminalising the locked row; a failure records only a stable code.
			if (command.outcome === "succeeded")
			{
				if (!command.testReport.passed || !command.scanResult.passed) return "conflict";
				const revision = await transaction.skillRevision.updateMany({ where: { id: workload.skillRevisionId, state: "Draft", testReport: { equals: Prisma.DbNull }, scanResult: { equals: Prisma.DbNull } }, data: { testReport: command.testReport as unknown as Prisma.InputJsonValue, scanResult: command.scanResult as unknown as Prisma.InputJsonValue } });
				if (revision.count !== 1) return "conflict";
			}

			const completed = await transaction.skillWorkload.updateMany({ where: { id: workload.id, state: SkillWorkloadState.Assigned }, data: command.outcome === "succeeded" ? { state: SkillWorkloadState.Succeeded, completedAt: new Date(), failureCode: null } : { state: SkillWorkloadState.Failed, completedAt: new Date(), failureCode: command.failureCode } });
			return completed.count === 1 ? "completed" : "conflict";
		});
	}
}
