import type { Prisma } from "@prisma/client";

import type { SkillWorkloadBootstrapIdentity, SkillWorkloadBootstrapRecord } from "./skill-workload-bootstrap.types";
import { _SkillWorkloadTimestampProposal } from "./prisma-skill-workload-timestamps";
import type { SkillWorkloadBootstrapRepository } from "./skill-workload-unit-of-work.types";

/** Reads and consumes a worker's bootstrap, only when its Job is unsuspended and its Pod is registered. */
export class PrismaSkillWorkloadBootstrapRepository implements SkillWorkloadBootstrapRepository
{
	/** Prisma client for this transaction. Only the unit of work supplies it. */
	private readonly transaction: Prisma.TransactionClient;

	/** Stores the transaction this repository reads and writes through. */
	constructor(transaction: Prisma.TransactionClient)
	{
		this.transaction = transaction;
	}

	/** Loads an unused, unexpired bootstrap, and only when its workload is unsuspended and has a registered worker Pod. */
	async loadUnconsumed(referenceHash: string): Promise<SkillWorkloadBootstrapRecord | null>
	{
		const now = await this._databaseNow();
		const bootstrap = await this.transaction.skillWorkloadBootstrap.findFirst({ where: { referenceHash, consumedAt: null, expiresAt: { gt: now }, skillWorkload: { releasedAt: { not: null }, workerPodUid: { not: null } } }, include: { skillWorkload: true } });
		if (bootstrap === null || bootstrap.skillWorkload.workerPodUid === null) return null;
		return { workloadId: bootstrap.skillWorkloadId, referenceHash: bootstrap.referenceHash, audience: bootstrap.audience, serviceAccountName: bootstrap.serviceAccountName, namespace: bootstrap.namespace, workloadUid: bootstrap.workloadUid, podUid: bootstrap.skillWorkload.workerPodUid };
	}

	/** Marks the bootstrap used, only while it is unexpired and its workload is unsuspended with this exact Pod. */
	async consume(referenceHash: string, identity: SkillWorkloadBootstrapIdentity): Promise<"consumed" | "conflict">
	{
		const now = await this._databaseNow();
		const updated = await this.transaction.skillWorkloadBootstrap.updateMany({ where: { referenceHash, consumedAt: null, expiresAt: { gt: now }, namespace: identity.namespace, serviceAccountName: identity.serviceAccountName, skillWorkload: { releasedAt: { not: null }, workerPodUid: identity.podUid } }, data: { consumedAt: _SkillWorkloadTimestampProposal, consumedByPodUid: identity.podUid } });
		return updated.count === 1 ? "consumed" : "conflict";
	}

	/** Reads the current time from the `skill_authority_clock` view, never from this process. */
	private async _databaseNow(): Promise<Date>
	{
		const clock = await this.transaction.skillAuthorityClock.findUnique({ where: { singleton: 1 } });
		if (clock === null || Number.isNaN(clock.now.getTime())) throw new Error("skill workload database clock unavailable");
		return clock.now;
	}
}
