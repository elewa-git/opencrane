import { Prisma, SkillWorkloadState } from "@prisma/client";

import type { SkillWorkloadPodRegistrationCommand, SkillWorkloadReleaseClaim, SkillWorkloadReleaseCommand } from "./skill-workload-claims.types.js";
import type { SkillWorkloadReleaseRepository } from "./skill-workload-unit-of-work.types.js";

/** Transaction-scoped Postgres authority for Job release and first-Pod registration. */
export class PrismaSkillWorkloadReleaseRepository implements SkillWorkloadReleaseRepository
{
	/** Transaction-scoped ORM client supplied only by the execution unit of work. */
	private readonly transaction: Prisma.TransactionClient;
	/** Maximum time the controller may hold a release claim. */
	private readonly claimLeaseMilliseconds: number;

	/** Creates the release persistence capability within an existing transaction. */
	constructor(transaction: Prisma.TransactionClient, claimLeaseMilliseconds: number)
	{
		this.transaction = transaction;
		this.claimLeaseMilliseconds = claimLeaseMilliseconds;
	}

	/** Claims one assigned bootstrap-ready Job for a later Kubernetes unsuspend operation. */
	async claimNextRelease(): Promise<SkillWorkloadReleaseClaim | null>
	{
		const rows = await this.transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT workload."id" FROM "skill_workloads" workload JOIN "skill_workload_bootstraps" bootstrap ON bootstrap."skill_workload_id" = workload."id" WHERE workload."state" = 'assigned'::"SkillWorkloadState" AND workload."released_at" IS NULL AND bootstrap."consumed_at" IS NULL AND bootstrap."expires_at" > clock_timestamp() AND (workload."release_claimed_at" IS NULL OR workload."release_claimed_at" <= clock_timestamp() - (${this.claimLeaseMilliseconds} * interval '1 millisecond')) ORDER BY workload."created_at", workload."id" LIMIT 1 FOR UPDATE OF workload, bootstrap SKIP LOCKED`);
		const id = rows[0]?.id;
		if (id === undefined) return null;
		const workload = await this.transaction.skillWorkload.findUnique({ where: { id } });
		const bootstrap = await this.transaction.skillWorkloadBootstrap.findUnique({ where: { skillWorkloadId: id } });
		const now = await _DatabaseTime(this.transaction);
		if (workload === null || bootstrap === null || now === null || bootstrap.consumedAt !== null || bootstrap.expiresAt <= now || workload.state !== SkillWorkloadState.Assigned || workload.workloadUid === null) return null;
		const claimedAt = new Date(Math.max(now.getTime(), (workload.releaseClaimedAt?.getTime() ?? -1) + 1));
		const releaseDeliveryCount = workload.releaseDeliveryCount + 1;
		const expiresAt = new Date(Math.min(claimedAt.getTime() + this.claimLeaseMilliseconds, bootstrap.expiresAt.getTime()));
		const updated = await this.transaction.skillWorkload.updateMany({ where: { id, state: SkillWorkloadState.Assigned, releasedAt: null, releaseClaimedAt: workload.releaseClaimedAt, releaseDeliveryCount: workload.releaseDeliveryCount }, data: { releaseClaimedAt: claimedAt, releaseDeliveryCount, releaseExpiresAt: expiresAt } });
		if (updated.count !== 1) throw new Error("skill workload release claim lost its fence");
		return { workloadId: workload.id, siloId: workload.siloId, kind: workload.kind === "Authoring" ? "authoring" : "tool-runner", workloadUid: workload.workloadUid, releaseClaimedAt: claimedAt.toISOString(), releaseDeliveryCount, expiresAt: expiresAt.toISOString() };
	}

	/** Commits an exact fresh release claim, or accepts only its immutable replay. */
	async commitRelease(workloadId: string, command: SkillWorkloadReleaseCommand): Promise<"released" | "idempotent" | "conflict">
	{
		if (!_IsReleaseCommandValid(workloadId, command)) return "conflict";
		await _LockWorkloadAndBootstrap(this.transaction, workloadId);
		const workload = await this.transaction.skillWorkload.findUnique({ where: { id: workloadId } });
		if (workload === null) return "conflict";
		if (workload.releasedAt !== null) return _IsSameRelease(workload, command) ? "idempotent" : "conflict";
		const now = await _DatabaseTime(this.transaction);
		const bootstrap = await this.transaction.skillWorkloadBootstrap.findUnique({ where: { skillWorkloadId: workloadId } });
		if (now === null || bootstrap === null || bootstrap.consumedAt !== null || bootstrap.expiresAt <= now || workload.state !== SkillWorkloadState.Assigned || workload.workloadUid !== command.workloadUid || !_IsSameRelease(workload, command) || workload.releaseExpiresAt === null || now >= workload.releaseExpiresAt) return "conflict";
		const updated = await this.transaction.skillWorkload.updateMany({ where: { id: workloadId, state: SkillWorkloadState.Assigned, workloadUid: command.workloadUid, releasedAt: null, releaseClaimedAt: workload.releaseClaimedAt, releaseDeliveryCount: workload.releaseDeliveryCount, releaseExpiresAt: workload.releaseExpiresAt }, data: { releasedAt: now } });
		return updated.count === 1 ? "released" : "conflict";
	}

	/** Registers exactly one Job-owned Pod while its release and bootstrap fences remain valid. */
	async registerFirstPod(workloadId: string, command: SkillWorkloadPodRegistrationCommand): Promise<"registered" | "idempotent" | "conflict">
	{
		if (!_IsReleaseCommandValid(workloadId, command) || command.podUid.length === 0) return "conflict";
		await _LockWorkloadAndBootstrap(this.transaction, workloadId);
		const workload = await this.transaction.skillWorkload.findUnique({ where: { id: workloadId } });
		const bootstrap = await this.transaction.skillWorkloadBootstrap.findUnique({ where: { skillWorkloadId: workloadId } });
		if (workload === null || bootstrap === null) return "conflict";
		if (workload.workerPodUid !== null) return workload.workerPodUid === command.podUid && _IsSameRelease(workload, command) ? "idempotent" : "conflict";
		const now = await _DatabaseTime(this.transaction);
		if (now === null || workload.state !== SkillWorkloadState.Assigned || workload.releasedAt === null || workload.workloadUid !== command.workloadUid || !_IsSameRelease(workload, command) || workload.releaseExpiresAt === null || now >= workload.releaseExpiresAt || bootstrap.consumedAt !== null || bootstrap.expiresAt <= now || bootstrap.workloadUid !== command.workloadUid) return "conflict";
		const updated = await this.transaction.skillWorkload.updateMany({ where: { id: workloadId, workerPodUid: null, workloadUid: command.workloadUid, releasedAt: workload.releasedAt, releaseClaimedAt: workload.releaseClaimedAt, releaseDeliveryCount: workload.releaseDeliveryCount, releaseExpiresAt: workload.releaseExpiresAt }, data: { workerPodUid: command.podUid } });
		return updated.count === 1 ? "registered" : "conflict";
	}
}

/** Reads database time so a controller clock cannot extend a release lease. */
async function _DatabaseTime(transaction: Prisma.TransactionClient): Promise<Date | null>
{
	const rows = await transaction.$queryRaw<Array<{ now: Date }>>(Prisma.sql`SELECT clock_timestamp()::timestamp(3) AS "now"`);
	return rows[0]?.now ?? null;
}

/** Locks workload then bootstrap, matching every release-side transition. */
async function _LockWorkloadAndBootstrap(transaction: Prisma.TransactionClient, workloadId: string): Promise<void>
{
	await transaction.$queryRaw(Prisma.sql`SELECT "id" FROM "skill_workloads" WHERE "id" = ${workloadId} FOR UPDATE`);
	await transaction.$queryRaw(Prisma.sql`SELECT "id" FROM "skill_workload_bootstraps" WHERE "skill_workload_id" = ${workloadId} FOR UPDATE`);
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
