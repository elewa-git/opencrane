import type { Prisma } from "@prisma/client";

import type { SkillWorkloadBootstrapIdentity, SkillWorkloadBootstrapRecord } from "./skill-workload-bootstrap.types.js";
import { _SkillWorkloadTimestampProposal } from "./prisma-skill-workload-timestamps.js";
import type { SkillWorkloadBootstrapRepository } from "./skill-workload-unit-of-work.types.js";

/** Prisma authority for one exact released-and-registered governed-skill bootstrap consumption. */
export class PrismaSkillWorkloadBootstrapRepository implements SkillWorkloadBootstrapRepository
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
		const now = await this._databaseNow();
		const bootstrap = await this.transaction.skillWorkloadBootstrap.findFirst({ where: { referenceHash, consumedAt: null, expiresAt: { gt: now }, skillWorkload: { releasedAt: { not: null }, workerPodUid: { not: null } } }, include: { skillWorkload: true } });
		if (bootstrap === null || bootstrap.skillWorkload.workerPodUid === null) return null;
		return { workloadId: bootstrap.skillWorkloadId, referenceHash: bootstrap.referenceHash, audience: bootstrap.audience, serviceAccountName: bootstrap.serviceAccountName, namespace: bootstrap.namespace, workloadUid: bootstrap.workloadUid, podUid: bootstrap.skillWorkload.workerPodUid };
	}

	/** Consumes one bootstrap only while every release and reviewed-Pod fence still holds. */
	async consume(referenceHash: string, identity: SkillWorkloadBootstrapIdentity): Promise<"consumed" | "conflict">
	{
		const now = await this._databaseNow();
		const updated = await this.transaction.skillWorkloadBootstrap.updateMany({ where: { referenceHash, consumedAt: null, expiresAt: { gt: now }, namespace: identity.namespace, serviceAccountName: identity.serviceAccountName, skillWorkload: { releasedAt: { not: null }, workerPodUid: identity.podUid } }, data: { consumedAt: _SkillWorkloadTimestampProposal, consumedByPodUid: identity.podUid } });
		return updated.count === 1 ? "consumed" : "conflict";
	}

	/** Reads database time through the read-only typed view owned by this repository. */
	private async _databaseNow(): Promise<Date>
	{
		const clock = await this.transaction.skillAuthorityClock.findUnique({ where: { singleton: 1 } });
		if (clock === null || Number.isNaN(clock.now.getTime())) throw new Error("skill workload database clock unavailable");
		return clock.now;
	}
}
