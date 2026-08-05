import { SkillRevisionState, SkillWorkloadKind, SkillWorkloadState, type Prisma } from "@prisma/client";

import { __CreateSkillWorkloadBootstrapReference, __HashSkillWorkloadBootstrapReference } from "@opencrane/contracts";

import type { SkillWorkloadAssignmentCommand, SkillWorkloadClaim } from "./skill-workload-claims.types.js";
import { _SkillWorkloadLeaseExpiryProposal, _SkillWorkloadTimestampProposal } from "./prisma-skill-workload-timestamps.js";
import type { SkillWorkloadAssignmentRepository } from "./skill-workload-unit-of-work.types.js";

/** Transaction-scoped Postgres authority for controller claim and suspended-Job assignment. */
export class PrismaSkillWorkloadAssignmentRepository implements SkillWorkloadAssignmentRepository
{
	/** Transaction-scoped ORM client supplied only by the execution unit of work. */
	private readonly transaction: Prisma.TransactionClient;
	/** Bounded claim lifetime applied consistently to claim and commit. */
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
		// 1. The read-only view keeps the established database-clock and SKIP LOCKED selection semantics.
		const candidate = await this.transaction.skillWorkloadClaimCandidate.findFirst();
		if (candidate === null || !_IsEligibleRevisionForKind(candidate.kind, candidate.revisionState)) return null;
		const workload = await this.transaction.skillWorkload.findUnique({ where: { id: candidate.id } });
		if (workload === null || workload.state !== SkillWorkloadState.Pending || workload.skillRevisionId !== candidate.skillRevisionId) return null;

		// 2. The proposal encodes only the lease duration; the trigger anchors both timestamps to database time.
		const deliveryCount = workload.deliveryCount + 1;
		const claimed = await this.transaction.skillWorkload.updateManyAndReturn({
			where: { id: workload.id, state: SkillWorkloadState.Pending, skillRevisionId: workload.skillRevisionId, claimedAt: workload.claimedAt, claimExpiresAt: workload.claimExpiresAt, deliveryCount: workload.deliveryCount },
			data: { claimedAt: _SkillWorkloadTimestampProposal, claimExpiresAt: _SkillWorkloadLeaseExpiryProposal(this.claimLeaseMilliseconds), deliveryCount },
			select: { claimedAt: true, claimExpiresAt: true },
		});
		const claim = claimed[0];
		if (claim === undefined || claim.claimedAt === null || claim.claimExpiresAt === null) throw new Error("skill workload claim lost its fence");
		return { workloadId: workload.id, siloId: workload.siloId, kind: workload.kind === SkillWorkloadKind.Authoring ? "authoring" : "tool-runner", skillRevisionId: workload.skillRevisionId, claimedAt: claim.claimedAt.toISOString(), deliveryCount, expiresAt: claim.claimExpiresAt.toISOString() };
	}

	/** Commits one exact claim generation with a hash-only bootstrap record. */
	async commitAssignment(workloadId: string, command: SkillWorkloadAssignmentCommand): Promise<"assigned" | "idempotent" | "conflict">
	{
		if (!await _IsAssignmentCommandValid(workloadId, command)) return "conflict";

		// 1. Rebind the workload, revision lifecycle, and any existing bootstrap in one snapshot.
		const workload = await this.transaction.skillWorkload.findUnique({ where: { id: workloadId }, include: { skillRevision: { select: { state: true } }, bootstrap: true } });
		if (workload === null || !_IsEligibleRevisionForKind(workload.kind, workload.skillRevision.state)) return "conflict";
		if (workload.state === SkillWorkloadState.Assigned)
		{
			return workload.workloadUid === command.workloadUid && workload.claimedAt?.getTime() === Date.parse(command.claimedAt) && workload.deliveryCount === command.deliveryCount && workload.bootstrap?.referenceHash === await __HashSkillWorkloadBootstrapReference(command.bootstrapReference) ? "idempotent" : "conflict";
		}

		// 2. Re-check the exact persisted lease before the irreversible assignment transition.
		const now = await this._databaseNow();
		if (workload.state !== SkillWorkloadState.Pending || workload.claimedAt?.getTime() !== Date.parse(command.claimedAt) || workload.claimExpiresAt === null || workload.deliveryCount !== command.deliveryCount || now >= workload.claimExpiresAt) return "conflict";

		// 3. Compare-and-swap assignment and create its bootstrap in the same serializable transaction.
		const updated = await this.transaction.skillWorkload.updateMany({ where: { id: workloadId, state: SkillWorkloadState.Pending, skillRevisionId: workload.skillRevisionId, claimedAt: workload.claimedAt, claimExpiresAt: workload.claimExpiresAt, deliveryCount: workload.deliveryCount, workloadUid: null }, data: { state: SkillWorkloadState.Assigned, workloadUid: command.workloadUid } });
		if (updated.count !== 1) return "conflict";
		const authoring = workload.kind === SkillWorkloadKind.Authoring;
		const audience = authoring ? "opencrane-skill-authoring" : "opencrane-tool-runner";
		const serviceAccountName = authoring ? "skill-authoring-default" : "tool-runner-default";
		await this.transaction.skillWorkloadBootstrap.create({ data: { skillWorkloadId: workloadId, referenceHash: await __HashSkillWorkloadBootstrapReference(command.bootstrapReference), audience, serviceAccountName, namespace: command.namespace, workloadUid: command.workloadUid } });
		return "assigned";
	}

	/** Reads database time through the read-only typed view owned by this repository. */
	private async _databaseNow(): Promise<Date>
	{
		const clock = await this.transaction.skillAuthorityClock.findUnique({ where: { singleton: 1 } });
		if (clock === null || Number.isNaN(clock.now.getTime())) throw new Error("skill workload database clock unavailable");
		return clock.now;
	}
}

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
