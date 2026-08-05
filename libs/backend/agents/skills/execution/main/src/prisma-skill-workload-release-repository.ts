import { SkillWorkloadKind, SkillWorkloadState, type Prisma } from "@prisma/client";

import type { SkillWorkloadPodRegistrationCommand, SkillWorkloadReleaseClaim, SkillWorkloadReleaseCommand } from "./skill-workload-claims.types.js";
import { _SkillWorkloadLeaseExpiryProposal, _SkillWorkloadTimestampProposal } from "./prisma-skill-workload-timestamps.js";
import type { SkillWorkloadReleaseRepository } from "./skill-workload-unit-of-work.types.js";

/** Transaction-scoped Postgres authority for Job release and first-Pod registration. */
export class PrismaSkillWorkloadReleaseRepository implements SkillWorkloadReleaseRepository
{
	/** Transaction-scoped ORM client supplied only by the execution unit of work. */
	private readonly transaction: Prisma.TransactionClient;
	/** Bounded release-claim lifetime applied consistently to every claim. */
	private readonly claimLeaseMilliseconds: number;
	/** Creates the release persistence capability within an existing transaction. */
	constructor(transaction: Prisma.TransactionClient, claimLeaseMilliseconds: number)
	{
		if (!Number.isSafeInteger(claimLeaseMilliseconds) || claimLeaseMilliseconds < 1 || claimLeaseMilliseconds > 300_000) throw new Error("skill workload claim lease must be bounded");
		this.transaction = transaction;
		this.claimLeaseMilliseconds = claimLeaseMilliseconds;
	}

	/** Claims one assigned bootstrap-ready Job for a later Kubernetes unsuspend operation. */
	async claimNextRelease(): Promise<SkillWorkloadReleaseClaim | null>
	{
		// 1. The read-only view retains database-clock filtering and nonblocking peer selection.
		const candidate = await this.transaction.skillWorkloadReleaseClaimCandidate.findFirst();
		if (candidate === null) return null;
		const workload = await this.transaction.skillWorkload.findUnique({ where: { id: candidate.id }, include: { bootstrap: true } });
		const bootstrap = workload?.bootstrap;
		if (workload === null || bootstrap === null || bootstrap === undefined || workload.workloadUid === null) return null;

		// 2. The proposal carries only the bounded duration; the trigger owns the timestamp and bootstrap cap.
		const releaseDeliveryCount = workload.releaseDeliveryCount + 1;
		const claimed = await this.transaction.skillWorkload.updateManyAndReturn({
			where: { id: workload.id, state: SkillWorkloadState.Assigned, releasedAt: null, releaseClaimedAt: workload.releaseClaimedAt, releaseDeliveryCount: workload.releaseDeliveryCount, bootstrap: { is: { consumedAt: null, expiresAt: bootstrap.expiresAt } } },
			data: { releaseClaimedAt: _SkillWorkloadTimestampProposal, releaseDeliveryCount, releaseExpiresAt: _SkillWorkloadLeaseExpiryProposal(this.claimLeaseMilliseconds) },
			select: { releaseClaimedAt: true, releaseExpiresAt: true },
		});
		const claim = claimed[0];
		if (claim === undefined || claim.releaseClaimedAt === null || claim.releaseExpiresAt === null) throw new Error("skill workload release claim lost its fence");
		return { workloadId: workload.id, siloId: workload.siloId, kind: workload.kind === SkillWorkloadKind.Authoring ? "authoring" : "tool-runner", workloadUid: workload.workloadUid, releaseClaimedAt: claim.releaseClaimedAt.toISOString(), releaseDeliveryCount, expiresAt: claim.releaseExpiresAt.toISOString() };
	}

	/** Commits an exact fresh release claim, or accepts only its immutable replay. */
	async commitRelease(workloadId: string, command: SkillWorkloadReleaseCommand): Promise<"released" | "idempotent" | "conflict">
	{
		if (!_IsReleaseCommandValid(workloadId, command)) return "conflict";
		const workload = await this.transaction.skillWorkload.findUnique({ where: { id: workloadId }, include: { bootstrap: true } });
		if (workload === null) return "conflict";
		if (workload.releasedAt !== null) return _IsSameRelease(workload, command) ? "idempotent" : "conflict";
		const now = await this._databaseNow();
		const bootstrap = workload.bootstrap;
		if (bootstrap === null || bootstrap.consumedAt !== null || bootstrap.expiresAt <= now || workload.state !== SkillWorkloadState.Assigned || workload.workloadUid !== command.workloadUid || !_IsSameRelease(workload, command) || workload.releaseExpiresAt === null || now >= workload.releaseExpiresAt) return "conflict";
		const updated = await this.transaction.skillWorkload.updateMany({ where: { id: workloadId, state: SkillWorkloadState.Assigned, workloadUid: command.workloadUid, releasedAt: null, releaseClaimedAt: workload.releaseClaimedAt, releaseDeliveryCount: workload.releaseDeliveryCount, releaseExpiresAt: workload.releaseExpiresAt, bootstrap: { is: { consumedAt: null, expiresAt: { gt: now } } } }, data: { releasedAt: _SkillWorkloadTimestampProposal } });
		return updated.count === 1 ? "released" : "conflict";
	}

	/** Registers exactly one Job-owned Pod while its release and bootstrap fences remain valid. */
	async registerFirstPod(workloadId: string, command: SkillWorkloadPodRegistrationCommand): Promise<"registered" | "idempotent" | "conflict">
	{
		if (!_IsReleaseCommandValid(workloadId, command) || command.podUid.length === 0) return "conflict";
		const workload = await this.transaction.skillWorkload.findUnique({ where: { id: workloadId }, include: { bootstrap: true } });
		const bootstrap = workload?.bootstrap;
		if (workload === null || bootstrap === null || bootstrap === undefined) return "conflict";
		if (workload.workerPodUid !== null) return workload.workerPodUid === command.podUid && _IsSameRelease(workload, command) ? "idempotent" : "conflict";
		const now = await this._databaseNow();
		if (workload.state !== SkillWorkloadState.Assigned || workload.releasedAt === null || workload.workloadUid !== command.workloadUid || !_IsSameRelease(workload, command) || workload.releaseExpiresAt === null || now >= workload.releaseExpiresAt || bootstrap.consumedAt !== null || bootstrap.expiresAt <= now || bootstrap.workloadUid !== command.workloadUid) return "conflict";
		const updated = await this.transaction.skillWorkload.updateMany({ where: { id: workloadId, workerPodUid: null, workloadUid: command.workloadUid, releasedAt: workload.releasedAt, releaseClaimedAt: workload.releaseClaimedAt, releaseDeliveryCount: workload.releaseDeliveryCount, releaseExpiresAt: workload.releaseExpiresAt, bootstrap: { is: { consumedAt: null, expiresAt: bootstrap.expiresAt, workloadUid: command.workloadUid } } }, data: { workerPodUid: command.podUid } });
		return updated.count === 1 ? "registered" : "conflict";
	}

	/** Reads database time through the read-only typed view owned by this repository. */
	private async _databaseNow(): Promise<Date>
	{
		const clock = await this.transaction.skillAuthorityClock.findUnique({ where: { singleton: 1 } });
		if (clock === null || Number.isNaN(clock.now.getTime())) throw new Error("skill workload database clock unavailable");
		return clock.now;
	}
}

/** Validates a release coordinate before it contends on durable row locks. */
function _IsReleaseCommandValid(workloadId: string, command: SkillWorkloadReleaseCommand): boolean
{
	return workloadId.length > 0 && command.workloadUid.length > 0 && Number.isSafeInteger(command.releaseDeliveryCount) && command.releaseDeliveryCount >= 1 && Number.isFinite(Date.parse(command.releaseClaimedAt));
}

/** Compares every immutable coordinate of a successful release replay. */
function _IsSameRelease(workload: { readonly workloadUid: string | null; readonly releaseClaimedAt: Date | null; readonly releaseDeliveryCount: number }, command: SkillWorkloadReleaseCommand): boolean
{
	return workload.workloadUid === command.workloadUid && workload.releaseClaimedAt?.getTime() === Date.parse(command.releaseClaimedAt) && workload.releaseDeliveryCount === command.releaseDeliveryCount;
}
