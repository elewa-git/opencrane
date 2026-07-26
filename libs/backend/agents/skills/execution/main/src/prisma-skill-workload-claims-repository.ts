import { createHash } from "node:crypto";

import { Prisma, SkillRevisionState, SkillWorkloadKind, SkillWorkloadState, type PrismaClient } from "@prisma/client";

import type { SkillWorkloadAssignmentCommand, SkillWorkloadClaim, SkillWorkloadClaimsRepository, SkillWorkloadReleaseClaim, SkillWorkloadReleaseCommand } from "./skill-workload-claims.types.js";

/** Postgres authority for controller-only claim generations and immutable Job identity binding. */
export class PrismaSkillWorkloadClaimsRepository implements SkillWorkloadClaimsRepository
{
	/** Maximum worker lifetime and opaque-reference validity after assignment. */
	private static readonly bootstrapLifetimeMilliseconds = 900_000;
	/** Canonical OpenCrane authority database. */
	private readonly prisma: PrismaClient;
	/** Maximum time a controller may hold one uncommitted claim. */
	private readonly claimLeaseMilliseconds: number;

	/** Creates the authority with one bounded database-owned claim lease. */
	constructor(prisma: PrismaClient, claimLeaseMilliseconds: number)
	{
		if (!Number.isSafeInteger(claimLeaseMilliseconds) || claimLeaseMilliseconds < 1 || claimLeaseMilliseconds > 300_000) throw new Error("skill workload claim lease must be bounded");
		this.prisma = prisma;
		this.claimLeaseMilliseconds = claimLeaseMilliseconds;
	}

	/** Claims one pending or expired-unassigned record under its exact row lock. */
	async claimNextAtomically(): Promise<SkillWorkloadClaim | null>
	{
		const lease = this.claimLeaseMilliseconds;
		return this.prisma.$transaction(async function _claim(transaction: Prisma.TransactionClient): Promise<SkillWorkloadClaim | null>
		{
			// 1. Revision first — the lifecycle trigger takes this same order before it cancels its workloads.
			const candidates = await transaction.$queryRaw<Array<{ id: string; skillRevisionId: string; revisionState: SkillRevisionState; kind: SkillWorkloadKind }>>(Prisma.sql`SELECT workload."id", workload."skill_revision_id" AS "skillRevisionId", revision."state" AS "revisionState", workload."kind" FROM "skill_workloads" workload JOIN "skill_revisions" revision ON revision."id" = workload."skill_revision_id" WHERE workload."state" = 'pending'::"SkillWorkloadState" AND (workload."claimed_at" IS NULL OR workload."claimed_at" <= clock_timestamp() - (${lease} * interval '1 millisecond')) AND ((workload."kind" = 'authoring'::"SkillWorkloadKind" AND revision."state" = 'draft'::"SkillRevisionState") OR (workload."kind" = 'tool_runner'::"SkillWorkloadKind" AND revision."state" = 'published'::"SkillRevisionState")) ORDER BY workload."created_at", workload."id" LIMIT 1 FOR UPDATE OF revision SKIP LOCKED`);
			const candidate = candidates[0];
			if (!candidate || !_IsEligibleRevisionForKind(candidate.kind, candidate.revisionState)) return null;

			// 2. Workload second — the revision lock prevents a lifecycle change between eligibility and its claim fence.
			await transaction.$queryRaw(Prisma.sql`SELECT "id" FROM "skill_workloads" WHERE "id" = ${candidate.id} FOR UPDATE`);
			const id = candidate.id;
			const workload = await transaction.skillWorkload.findUnique({ where: { id } });
			const databaseTime = await transaction.$queryRaw<Array<{ now: Date }>>(Prisma.sql`SELECT clock_timestamp()::timestamp(3) AS "now"`);
			const now = databaseTime[0]?.now;
			if (!workload || !now || workload.state !== SkillWorkloadState.Pending || !_IsEligibleRevisionForKind(workload.kind, candidate.revisionState)) return null;

			// 3. CAS claim — stale controller replicas can only advance the one generation they locked.
			const claimedAt = new Date(Math.max(now.getTime(), (workload.claimedAt?.getTime() ?? -1) + 1));
			const deliveryCount = workload.deliveryCount + 1;
			const updated = await transaction.skillWorkload.updateMany({ where: { id, state: SkillWorkloadState.Pending, claimedAt: workload.claimedAt, deliveryCount: workload.deliveryCount }, data: { claimedAt, deliveryCount } });
			if (updated.count !== 1) throw new Error("skill workload claim lost its fence");
			return { workloadId: workload.id, siloId: workload.siloId, kind: workload.kind === "Authoring" ? "authoring" : "tool-runner", skillRevisionId: workload.skillRevisionId, claimedAt: claimedAt.toISOString(), deliveryCount, expiresAt: new Date(claimedAt.getTime() + lease).toISOString() };
		});
	}

	/** Commits only one unexpired exact claim generation, or returns its immutable replay result. */
	async commitAssignmentAtomically(workloadId: string, command: SkillWorkloadAssignmentCommand): Promise<"assigned" | "idempotent" | "conflict">
	{
		if (!workloadId || !command.workloadUid || !/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(command.namespace) || command.namespace.length > 63 || command.bootstrapReference !== _BootstrapReference(workloadId) || !Number.isSafeInteger(command.deliveryCount) || command.deliveryCount < 1 || !Number.isFinite(Date.parse(command.claimedAt))) return "conflict";
		const lease = this.claimLeaseMilliseconds;
		try
		{
			return await this.prisma.$transaction(async function _commit(transaction: Prisma.TransactionClient): Promise<"assigned" | "idempotent" | "conflict">
			{
				// 1. Revision first — shares the lifecycle trigger's lock order and makes eligibility stable.
				const sources = await transaction.$queryRaw<Array<{ skillRevisionId: string }>>(Prisma.sql`SELECT "skill_revision_id" AS "skillRevisionId" FROM "skill_workloads" WHERE "id" = ${workloadId}`);
				const source = sources[0];
				if (!source) return "conflict";
				const revisions = await transaction.$queryRaw<Array<{ state: SkillRevisionState }>>(Prisma.sql`SELECT "state" FROM "skill_revisions" WHERE "id" = ${source.skillRevisionId} FOR UPDATE`);

				// 2. Workload second — read the exact claimed generation only after its source revision is locked.
				await transaction.$queryRaw(Prisma.sql`SELECT "id" FROM "skill_workloads" WHERE "id" = ${workloadId} FOR UPDATE`);
				const workload = await transaction.skillWorkload.findUnique({ where: { id: workloadId } });
				const revision = revisions[0];
				if (!workload || !revision || !_IsEligibleRevisionForKind(workload.kind, revision.state)) return "conflict";
				if (workload.state === SkillWorkloadState.Assigned)
				{
					const bootstrap = await transaction.skillWorkloadBootstrap.findUnique({ where: { skillWorkloadId: workloadId } });
					return workload.workloadUid === command.workloadUid && workload.claimedAt?.getTime() === Date.parse(command.claimedAt) && workload.deliveryCount === command.deliveryCount && bootstrap?.referenceHash === _ReferenceHash(command.bootstrapReference) ? "idempotent" : "conflict";
				}
				const nowRows = await transaction.$queryRaw<Array<{ now: Date }>>(Prisma.sql`SELECT clock_timestamp()::timestamp(3) AS "now"`);
				const now = nowRows[0]?.now;
				if (!now || workload.state !== SkillWorkloadState.Pending || workload.claimedAt?.getTime() !== Date.parse(command.claimedAt) || workload.deliveryCount !== command.deliveryCount || now.getTime() >= workload.claimedAt.getTime() + lease) return "conflict";

				// 3. Assignment CAS — the database rejects a replay, expired lease, or competing Job identity.
				const updated = await transaction.skillWorkload.updateMany({ where: { id: workloadId, state: SkillWorkloadState.Pending, claimedAt: workload.claimedAt, deliveryCount: workload.deliveryCount, workloadUid: null }, data: { state: SkillWorkloadState.Assigned, workloadUid: command.workloadUid } });
				if (updated.count !== 1) return "conflict";
				await transaction.skillWorkloadBootstrap.create({ data: {
					skillWorkloadId: workloadId,
					referenceHash: _ReferenceHash(command.bootstrapReference),
					audience: workload.kind === "Authoring" ? "opencrane-skill-authoring" : "opencrane-tool-runner",
					serviceAccountName: workload.kind === "Authoring" ? "skill-authoring-default" : "tool-runner-default",
					namespace: command.namespace,
					workloadUid: command.workloadUid,
					expiresAt: new Date(now.getTime() + PrismaSkillWorkloadClaimsRepository.bootstrapLifetimeMilliseconds),
				} });
				return "assigned";
			});
		}
		catch (error)
		{
			if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2002" || error.code === "P2034")) return "conflict";
			throw error;
		}
	}

	/** Claims one assigned bootstrap-ready workload for an exact Kubernetes release. */
	async claimNextReleaseAtomically(): Promise<SkillWorkloadReleaseClaim | null>
	{
		const lease = this.claimLeaseMilliseconds;
		return this.prisma.$transaction(async function _claimRelease(transaction: Prisma.TransactionClient): Promise<SkillWorkloadReleaseClaim | null>
		{
			const rows = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT workload."id" FROM "skill_workloads" workload JOIN "skill_workload_bootstraps" bootstrap ON bootstrap."skill_workload_id" = workload."id" WHERE workload."state" = 'assigned'::"SkillWorkloadState" AND workload."released_at" IS NULL AND bootstrap."consumed_at" IS NULL AND bootstrap."expires_at" > clock_timestamp() AND (workload."release_claimed_at" IS NULL OR workload."release_claimed_at" <= clock_timestamp() - (${lease} * interval '1 millisecond')) ORDER BY workload."created_at", workload."id" LIMIT 1 FOR UPDATE OF workload, bootstrap SKIP LOCKED`);
			const id = rows[0]?.id;
			if (!id) return null;
			const workload = await transaction.skillWorkload.findUnique({ where: { id } });
			const bootstrap = await transaction.skillWorkloadBootstrap.findUnique({ where: { skillWorkloadId: id } });
			const nowRows = await transaction.$queryRaw<Array<{ now: Date }>>(Prisma.sql`SELECT clock_timestamp()::timestamp(3) AS "now"`);
			const now = nowRows[0]?.now;
			if (!workload || !bootstrap || !now || bootstrap.consumedAt !== null || bootstrap.expiresAt <= now || workload.state !== SkillWorkloadState.Assigned || !workload.workloadUid) return null;
			const claimedAt = new Date(Math.max(now.getTime(), (workload.releaseClaimedAt?.getTime() ?? -1) + 1));
			const deliveryCount = workload.releaseDeliveryCount + 1;
			const expiresAt = new Date(Math.min(claimedAt.getTime() + lease, bootstrap.expiresAt.getTime()));
			const updated = await transaction.skillWorkload.updateMany({ where: { id, state: SkillWorkloadState.Assigned, releasedAt: null, releaseClaimedAt: workload.releaseClaimedAt, releaseDeliveryCount: workload.releaseDeliveryCount }, data: { releaseClaimedAt: claimedAt, releaseDeliveryCount: deliveryCount, releaseExpiresAt: expiresAt } });
			if (updated.count !== 1) throw new Error("skill workload release claim lost its fence");
			return { workloadId: workload.id, workloadUid: workload.workloadUid, releaseClaimedAt: claimedAt.toISOString(), releaseDeliveryCount: deliveryCount, expiresAt: expiresAt.toISOString() };
		});
	}

	/** Commits only the same fresh release claim and exact immutable Kubernetes Job UID. */
	async commitReleaseAtomically(workloadId: string, command: SkillWorkloadReleaseCommand): Promise<"released" | "idempotent" | "conflict">
	{
		if (!workloadId || !command.workloadUid || !Number.isSafeInteger(command.releaseDeliveryCount) || command.releaseDeliveryCount < 1 || !Number.isFinite(Date.parse(command.releaseClaimedAt))) return "conflict";
		const lease = this.claimLeaseMilliseconds;
		return this.prisma.$transaction(async function _commitRelease(transaction: Prisma.TransactionClient): Promise<"released" | "idempotent" | "conflict">
		{
			await transaction.$queryRaw(Prisma.sql`SELECT "id" FROM "skill_workloads" WHERE "id" = ${workloadId} FOR UPDATE`);
			await transaction.$queryRaw(Prisma.sql`SELECT "id" FROM "skill_workload_bootstraps" WHERE "skill_workload_id" = ${workloadId} FOR UPDATE`);
			const workload = await transaction.skillWorkload.findUnique({ where: { id: workloadId } });
			if (!workload) return "conflict";
			if (workload.releasedAt !== null) return workload.workloadUid === command.workloadUid && workload.releaseClaimedAt?.getTime() === Date.parse(command.releaseClaimedAt) && workload.releaseDeliveryCount === command.releaseDeliveryCount ? "idempotent" : "conflict";
			const nowRows = await transaction.$queryRaw<Array<{ now: Date }>>(Prisma.sql`SELECT clock_timestamp()::timestamp(3) AS "now"`);
			const now = nowRows[0]?.now;
			const bootstrap = await transaction.skillWorkloadBootstrap.findUnique({ where: { skillWorkloadId: workloadId } });
			if (!now || !bootstrap || bootstrap.consumedAt !== null || bootstrap.expiresAt <= now || workload.state !== SkillWorkloadState.Assigned || workload.workloadUid !== command.workloadUid || workload.releaseClaimedAt?.getTime() !== Date.parse(command.releaseClaimedAt) || workload.releaseDeliveryCount !== command.releaseDeliveryCount || !workload.releaseExpiresAt || now >= workload.releaseExpiresAt) return "conflict";
			const updated = await transaction.skillWorkload.updateMany({ where: { id: workloadId, state: SkillWorkloadState.Assigned, workloadUid: command.workloadUid, releasedAt: null, releaseClaimedAt: workload.releaseClaimedAt, releaseDeliveryCount: workload.releaseDeliveryCount, releaseExpiresAt: workload.releaseExpiresAt }, data: { releasedAt: now } });
			return updated.count === 1 ? "released" : "conflict";
		});
	}
}

/** Convert the transient controller reference into the only durable bootstrap lookup coordinate. */
function _ReferenceHash(reference: string): string
{
	return `sha256:${createHash("sha256").update(reference, "utf8").digest("hex")}`;
}

/** Derive the one deterministic opaque reference that the server accepts for a skill workload. */
function _BootstrapReference(workloadId: string): string
{
	return `skill-bootstrap-v1_${createHash("sha256").update(workloadId, "utf8").digest("hex")}`;
}

/** Returns whether a workload class may still run for the locked revision lifecycle state. */
function _IsEligibleRevisionForKind(kind: SkillWorkloadKind, state: SkillRevisionState): boolean
{
	return (kind === SkillWorkloadKind.Authoring && state === SkillRevisionState.Draft) || (kind === SkillWorkloadKind.ToolRunner && state === SkillRevisionState.Published);
}
