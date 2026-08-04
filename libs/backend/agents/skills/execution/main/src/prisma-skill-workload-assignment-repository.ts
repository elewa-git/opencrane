import { Prisma, SkillRevisionState, SkillWorkloadKind, SkillWorkloadState } from "@prisma/client";

import { __CreateSkillWorkloadBootstrapReference, __HashSkillWorkloadBootstrapReference } from "@opencrane/contracts";

import type { SkillWorkloadAssignmentCommand, SkillWorkloadClaim } from "./skill-workload-claims.types.js";
import type { SkillWorkloadAssignmentRepository } from "./skill-workload-unit-of-work.types.js";

/** Transaction-scoped Postgres authority for controller claim and suspended-Job assignment. */
export class PrismaSkillWorkloadAssignmentRepository implements SkillWorkloadAssignmentRepository
{
	/** Transaction-scoped ORM client supplied only by the execution unit of work. */
	private readonly transaction: Prisma.TransactionClient;
	/** Database-owned claim lifetime applied consistently to claim and commit. */
	private readonly claimLeaseMilliseconds: number;
	/** Creates the assignment persistence capability within an existing transaction. */
	constructor(transaction: Prisma.TransactionClient, claimLeaseMilliseconds: number)
	{
		if (!Number.isSafeInteger(claimLeaseMilliseconds) || claimLeaseMilliseconds < 1 || claimLeaseMilliseconds > 300_000) throw new Error("skill workload claim lease must be bounded");
		this.transaction = transaction;
		this.claimLeaseMilliseconds = claimLeaseMilliseconds;
	}

	/** Claims one pending workload while keeping revision lifecycle and delivery generation fenced. */
	async claimNext(): Promise<SkillWorkloadClaim | null>
	{
		const claimLeaseMilliseconds = this.claimLeaseMilliseconds;
		// 1. Lock revision first so lifecycle cancellation cannot race the eligibility decision.
		const candidates = await this.transaction.$queryRaw<Array<{ id: string; skillRevisionId: string; revisionState: SkillRevisionState; kind: SkillWorkloadKind }>>(Prisma.sql`SELECT workload."id", workload."skill_revision_id" AS "skillRevisionId", revision."state" AS "revisionState", workload."kind" FROM "skill_workloads" workload JOIN "skill_revisions" revision ON revision."id" = workload."skill_revision_id" WHERE workload."state" = 'pending'::"SkillWorkloadState" AND (workload."claimed_at" IS NULL OR workload."claimed_at" <= clock_timestamp() - (${claimLeaseMilliseconds} * interval '1 millisecond')) AND ((workload."kind" = 'authoring'::"SkillWorkloadKind" AND revision."state" = 'draft'::"SkillRevisionState") OR (workload."kind" = 'tool_runner'::"SkillWorkloadKind" AND revision."state" = 'published'::"SkillRevisionState")) ORDER BY workload."created_at", workload."id" LIMIT 1 FOR UPDATE OF revision SKIP LOCKED`);
		const candidate = candidates[0];
		if (candidate === undefined || !_IsEligibleRevisionForKind(candidate.kind, candidate.revisionState)) return null;

		// 2. Lock workload second before reading the exact generation that the controller must return.
		await this.transaction.$queryRaw(Prisma.sql`SELECT "id" FROM "skill_workloads" WHERE "id" = ${candidate.id} FOR UPDATE`);
		const workload = await this.transaction.skillWorkload.findUnique({ where: { id: candidate.id } });
		const now = await this._databaseTime();
		if (workload === null || now === null || workload.state !== SkillWorkloadState.Pending || !_IsEligibleRevisionForKind(workload.kind, candidate.revisionState)) return null;

		// 3. Advance the delivery generation atomically so controller replicas cannot share a claim.
		const claimedAt = new Date(Math.max(now.getTime(), (workload.claimedAt?.getTime() ?? -1) + 1));
		const deliveryCount = workload.deliveryCount + 1;
		const updated = await this.transaction.skillWorkload.updateMany({ where: { id: workload.id, state: SkillWorkloadState.Pending, claimedAt: workload.claimedAt, deliveryCount: workload.deliveryCount }, data: { claimedAt, deliveryCount } });
		if (updated.count !== 1) throw new Error("skill workload claim lost its fence");
		return { workloadId: workload.id, siloId: workload.siloId, kind: workload.kind === SkillWorkloadKind.Authoring ? "authoring" : "tool-runner", skillRevisionId: workload.skillRevisionId, claimedAt: claimedAt.toISOString(), deliveryCount, expiresAt: new Date(claimedAt.getTime() + claimLeaseMilliseconds).toISOString() };
	}

	/** Commits one exact claim generation with a hash-only bootstrap record. */
	async commitAssignment(workloadId: string, command: SkillWorkloadAssignmentCommand): Promise<"assigned" | "idempotent" | "conflict">
	{
		const claimLeaseMilliseconds = this.claimLeaseMilliseconds;
		if (!await _IsAssignmentCommandValid(workloadId, command)) return "conflict";

		// 1. Lock revision before workload, matching lifecycle trigger lock ordering.
		const sources = await this.transaction.$queryRaw<Array<{ skillRevisionId: string }>>(Prisma.sql`SELECT "skill_revision_id" AS "skillRevisionId" FROM "skill_workloads" WHERE "id" = ${workloadId}`);
		const source = sources[0];
		if (source === undefined) return "conflict";
		const revisions = await this.transaction.$queryRaw<Array<{ state: SkillRevisionState }>>(Prisma.sql`SELECT "state" FROM "skill_revisions" WHERE "id" = ${source.skillRevisionId} FOR UPDATE`);
		await this.transaction.$queryRaw(Prisma.sql`SELECT "id" FROM "skill_workloads" WHERE "id" = ${workloadId} FOR UPDATE`);
		const workload = await this.transaction.skillWorkload.findUnique({ where: { id: workloadId } });
		const revision = revisions[0];
		if (workload === null || revision === undefined || !_IsEligibleRevisionForKind(workload.kind, revision.state)) return "conflict";
		if (workload.state === SkillWorkloadState.Assigned)
		{
			const bootstrap = await this.transaction.skillWorkloadBootstrap.findUnique({ where: { skillWorkloadId: workloadId } });
			return workload.workloadUid === command.workloadUid && workload.claimedAt?.getTime() === Date.parse(command.claimedAt) && workload.deliveryCount === command.deliveryCount && bootstrap?.referenceHash === await __HashSkillWorkloadBootstrapReference(command.bootstrapReference) ? "idempotent" : "conflict";
		}

		// 2. Re-check the exact lease under the locks before the irreversible assignment transition.
		const now = await this._databaseTime();
		if (now === null || workload.state !== SkillWorkloadState.Pending || workload.claimedAt?.getTime() !== Date.parse(command.claimedAt) || workload.deliveryCount !== command.deliveryCount || now.getTime() >= workload.claimedAt.getTime() + claimLeaseMilliseconds) return "conflict";

		// 3. CAS assignment and bootstrap creation together so neither durable record can exist alone.
		const updated = await this.transaction.skillWorkload.updateMany({ where: { id: workloadId, state: SkillWorkloadState.Pending, claimedAt: workload.claimedAt, deliveryCount: workload.deliveryCount, workloadUid: null }, data: { state: SkillWorkloadState.Assigned, workloadUid: command.workloadUid } });
		if (updated.count !== 1) return "conflict";
		await this.transaction.skillWorkloadBootstrap.create({ data: { skillWorkloadId: workloadId, referenceHash: await __HashSkillWorkloadBootstrapReference(command.bootstrapReference), audience: workload.kind === SkillWorkloadKind.Authoring ? "opencrane-skill-authoring" : "opencrane-tool-runner", serviceAccountName: workload.kind === SkillWorkloadKind.Authoring ? "skill-authoring-default" : "tool-runner-default", namespace: command.namespace, workloadUid: command.workloadUid, expiresAt: new Date(now.getTime() + _BOOTSTRAP_LIFETIME_MILLISECONDS) } });
		return "assigned";
	}

	/** Reads database time so a controller clock cannot extend a lease. */
	private async _databaseTime(): Promise<Date | null>
	{
		const rows = await this.transaction.$queryRaw<Array<{ now: Date }>>(Prisma.sql`SELECT clock_timestamp()::timestamp(3) AS "now"`);
		return rows[0]?.now ?? null;
	}
}

/** Bootstrap remains valid only for the governed worker's bounded lifetime. */
const _BOOTSTRAP_LIFETIME_MILLISECONDS = 900_000;

/** Validates all caller-visible assignment coordinates before it queries durable authority state. */
async function _IsAssignmentCommandValid(workloadId: string, command: SkillWorkloadAssignmentCommand): Promise<boolean>
{
	return workloadId.length > 0 && command.workloadUid.length > 0 && /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(command.namespace) && command.namespace.length <= 63 && command.bootstrapReference === await __CreateSkillWorkloadBootstrapReference(workloadId) && Number.isSafeInteger(command.deliveryCount) && command.deliveryCount >= 1 && Number.isFinite(Date.parse(command.claimedAt));
}

/** Returns whether the locked revision lifecycle still permits this workload class. */
function _IsEligibleRevisionForKind(kind: SkillWorkloadKind, state: SkillRevisionState): boolean
{
	return (kind === SkillWorkloadKind.Authoring && state === SkillRevisionState.Draft) || (kind === SkillWorkloadKind.ToolRunner && state === SkillRevisionState.Published);
}
