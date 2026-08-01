import { Prisma } from "@prisma/client";

import type { SkillWorkloadBootstrapIdentity, SkillWorkloadBootstrapRecord } from "./skill-workload-bootstrap.types.js";
import type { SkillWorkloadBootstrapPersistence } from "./skill-workload-unit-of-work.types.js";

/** Prisma authority for one exact released-and-registered governed-skill bootstrap consumption. */
export class PrismaSkillWorkloadBootstrapRepository implements SkillWorkloadBootstrapPersistence
{
	/** Transaction-scoped ORM client supplied only by the execution unit of work. */
	private readonly transaction: Prisma.TransactionClient;

	/** Creates the one-use bootstrap authority over canonical Postgres. */
	constructor(transaction: Prisma.TransactionClient)
	{
		this.transaction = transaction;
	}

	/** Loads only an unconsumed record whose released workload has one canonical worker Pod. */
	async loadUnconsumed(referenceHash: string): Promise<SkillWorkloadBootstrapRecord | null>
	{
		const bootstrap = await this.transaction.skillWorkloadBootstrap.findFirst({ where: { referenceHash, consumedAt: null, expiresAt: { gt: new Date() }, skillWorkload: { releasedAt: { not: null }, workerPodUid: { not: null } } }, include: { skillWorkload: true } });
		if (bootstrap === null || bootstrap.skillWorkload.workerPodUid === null) return null;
		return { workloadId: bootstrap.skillWorkloadId, referenceHash: bootstrap.referenceHash, audience: bootstrap.audience, serviceAccountName: bootstrap.serviceAccountName, namespace: bootstrap.namespace, workloadUid: bootstrap.workloadUid, podUid: bootstrap.skillWorkload.workerPodUid };
	}

	/** Consumes one bootstrap only while every release and reviewed-Pod fence still holds. */
	async consume(referenceHash: string, identity: SkillWorkloadBootstrapIdentity): Promise<"consumed" | "conflict">
	{
		const updated = await this.transaction.$executeRaw(Prisma.sql`UPDATE "skill_workload_bootstraps" bootstrap SET "consumed_at" = clock_timestamp(), "consumed_by_pod_uid" = ${identity.podUid} FROM "skill_workloads" workload WHERE bootstrap."skill_workload_id" = workload."id" AND bootstrap."reference_hash" = ${referenceHash} AND bootstrap."consumed_at" IS NULL AND bootstrap."expires_at" > clock_timestamp() AND workload."released_at" IS NOT NULL AND workload."worker_pod_uid" = ${identity.podUid} AND bootstrap."namespace" = ${identity.namespace} AND bootstrap."service_account_name" = ${identity.serviceAccountName}`);
		return updated === 1 ? "consumed" : "conflict";
	}
}
