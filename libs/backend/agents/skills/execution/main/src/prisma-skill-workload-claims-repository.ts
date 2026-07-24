import { Prisma, SkillWorkloadState, type PrismaClient } from "@prisma/client";

import type { SkillWorkloadAssignmentCommand, SkillWorkloadClaim, SkillWorkloadClaimsRepository } from "./skill-workload-claims.types.js";

/** Postgres authority for controller-only claim generations and immutable Job identity binding. */
export class PrismaSkillWorkloadClaimsRepository implements SkillWorkloadClaimsRepository
{
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
			const rows = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT "id" FROM "skill_workloads" WHERE "state" = 'pending'::"SkillWorkloadState" AND ("claimed_at" IS NULL OR "claimed_at" <= clock_timestamp() - (${lease} * interval '1 millisecond')) ORDER BY "created_at", "id" LIMIT 1 FOR UPDATE SKIP LOCKED`);
			const id = rows[0]?.id;
			if (!id) return null;
			const workload = await transaction.skillWorkload.findUnique({ where: { id } });
			const databaseTime = await transaction.$queryRaw<Array<{ now: Date }>>(Prisma.sql`SELECT clock_timestamp()::timestamp(3) AS "now"`);
			const now = databaseTime[0]?.now;
			if (!workload || !now || workload.state !== SkillWorkloadState.Pending) return null;
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
		if (!workloadId || !command.workloadUid || !Number.isSafeInteger(command.deliveryCount) || command.deliveryCount < 1 || !Number.isFinite(Date.parse(command.claimedAt))) return "conflict";
		const lease = this.claimLeaseMilliseconds;
		return this.prisma.$transaction(async function _commit(transaction: Prisma.TransactionClient): Promise<"assigned" | "idempotent" | "conflict">
		{
			await transaction.$queryRaw(Prisma.sql`SELECT "id" FROM "skill_workloads" WHERE "id" = ${workloadId} FOR UPDATE`);
			const workload = await transaction.skillWorkload.findUnique({ where: { id: workloadId } });
			if (!workload) return "conflict";
			if (workload.state === SkillWorkloadState.Assigned) return workload.workloadUid === command.workloadUid && workload.claimedAt?.getTime() === Date.parse(command.claimedAt) && workload.deliveryCount === command.deliveryCount ? "idempotent" : "conflict";
			const nowRows = await transaction.$queryRaw<Array<{ now: Date }>>(Prisma.sql`SELECT clock_timestamp()::timestamp(3) AS "now"`);
			const now = nowRows[0]?.now;
			if (!now || workload.state !== SkillWorkloadState.Pending || workload.claimedAt?.getTime() !== Date.parse(command.claimedAt) || workload.deliveryCount !== command.deliveryCount || now.getTime() >= workload.claimedAt.getTime() + lease) return "conflict";
			const updated = await transaction.skillWorkload.updateMany({ where: { id: workloadId, state: SkillWorkloadState.Pending, claimedAt: workload.claimedAt, deliveryCount: workload.deliveryCount, workloadUid: null }, data: { state: SkillWorkloadState.Assigned, workloadUid: command.workloadUid } });
			return updated.count === 1 ? "assigned" : "conflict";
		});
	}
}
