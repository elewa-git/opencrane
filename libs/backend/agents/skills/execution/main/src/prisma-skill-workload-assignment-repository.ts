import { SkillRevisionState, SkillWorkloadKind, SkillWorkloadState, type Prisma } from "@prisma/client";

import { __CreateSkillWorkloadBootstrapReference, __HashSkillWorkloadBootstrapReference, TOOL_RUNNER_PROJECTED_TOKEN_AUDIENCE, TOOL_RUNNER_SERVICE_ACCOUNT_NAME } from "@opencrane/contracts";

import type { SkillWorkloadAssignmentCommand, SkillWorkloadClaim } from "./skill-workload-claims.types";
import { _SkillWorkloadLeaseExpiryProposal, _SkillWorkloadTimestampProposal } from "./prisma-skill-workload-timestamps";
import type { SkillWorkloadAssignmentRepository } from "./skill-workload-unit-of-work.types";

/** Claims workloads and records Job assignments in Postgres, inside one transaction. */
export class PrismaSkillWorkloadAssignmentRepository implements SkillWorkloadAssignmentRepository
{
	/** Prisma client for this transaction. Only the unit of work supplies it. */
	private readonly transaction: Prisma.TransactionClient;
	/** How long a claim lasts. The same value is used when claiming and when committing. */
	private readonly claimLeaseMilliseconds: number;
	/** Creates the assignment persistence capability within an existing transaction. */
	constructor(transaction: Prisma.TransactionClient, claimLeaseMilliseconds: number)
	{
		if (!Number.isSafeInteger(claimLeaseMilliseconds) || claimLeaseMilliseconds < 1 || claimLeaseMilliseconds > 300_000) throw new Error("skill workload claim lease must be bounded");
		this.transaction = transaction;
		this.claimLeaseMilliseconds = claimLeaseMilliseconds;
	}

	/** Claims one pending workload, checking the revision's state and raising the delivery counter by one. */
	async claimNext(): Promise<SkillWorkloadClaim | null>
	{
		// 1. The `skill_workload_claim_candidates` view does the picking: it filters on the database clock and uses SKIP LOCKED, so two dispatchers never take the same row.
		const candidate = await this.transaction.skillWorkloadClaimCandidate.findFirst({ where: { kind: SkillWorkloadKind.ToolRunner } });
		if (candidate === null || !_IsEligibleRevisionForKind(candidate.kind, candidate.revisionState)) return null;
		const workload = await this.transaction.skillWorkload.findUnique({ where: { id: candidate.id } });
		if (workload === null || workload.state !== SkillWorkloadState.Pending || workload.skillRevisionId !== candidate.skillRevisionId) return null;

		// 2. We send only the lease length. The `skill_workloads_authority` trigger replaces both timestamps with database time, keeping the gap between them.
		const deliveryCount = workload.deliveryCount + 1;
		const claimed = await this.transaction.skillWorkload.updateManyAndReturn({
			where: { id: workload.id, state: SkillWorkloadState.Pending, skillRevisionId: workload.skillRevisionId, claimedAt: workload.claimedAt, claimExpiresAt: workload.claimExpiresAt, deliveryCount: workload.deliveryCount },
			data: { claimedAt: _SkillWorkloadTimestampProposal, claimExpiresAt: _SkillWorkloadLeaseExpiryProposal(this.claimLeaseMilliseconds), deliveryCount },
			select: { claimedAt: true, claimExpiresAt: true },
		});
		const claim = claimed[0];
		if (claim === undefined || claim.claimedAt === null || claim.claimExpiresAt === null) throw new Error("skill workload claim lost its fence");
		return { workloadId: workload.id, siloId: workload.siloId, kind: "tool-runner", skillRevisionId: workload.skillRevisionId, claimedAt: claim.claimedAt.toISOString(), deliveryCount, expiresAt: claim.claimExpiresAt.toISOString() };
	}

	/** Records the assignment for the claim the controller holds, storing only a hash of the bootstrap reference. */
	async commitAssignment(workloadId: string, command: SkillWorkloadAssignmentCommand): Promise<"assigned" | "idempotent" | "conflict">
	{
		if (!await _IsAssignmentCommandValid(workloadId, command)) return "conflict";

		// 1. Re-read the workload, its revision state, and any existing bootstrap inside this transaction.
		const workload = await this.transaction.skillWorkload.findUnique({ where: { id: workloadId }, include: { skillRevision: { select: { state: true } }, bootstrap: true } });
		if (workload === null || !_IsEligibleRevisionForKind(workload.kind, workload.skillRevision.state)) return "conflict";
		if (workload.state === SkillWorkloadState.Assigned)
		{
			return workload.workloadUid === command.workloadUid && workload.claimedAt?.getTime() === Date.parse(command.claimedAt) && workload.deliveryCount === command.deliveryCount && workload.bootstrap?.referenceHash === await __HashSkillWorkloadBootstrapReference(command.bootstrapReference) ? "idempotent" : "conflict";
		}

		// 2. Check the stored claim has not expired, because the assignment cannot be undone.
		const now = await this._databaseNow();
		if (workload.state !== SkillWorkloadState.Pending || workload.claimedAt?.getTime() !== Date.parse(command.claimedAt) || workload.claimExpiresAt === null || workload.deliveryCount !== command.deliveryCount || now >= workload.claimExpiresAt) return "conflict";

		// 3. Update the row with a compare-and-swap and create its bootstrap row in the same transaction.
		const updated = await this.transaction.skillWorkload.updateMany({ where: { id: workloadId, state: SkillWorkloadState.Pending, skillRevisionId: workload.skillRevisionId, claimedAt: workload.claimedAt, claimExpiresAt: workload.claimExpiresAt, deliveryCount: workload.deliveryCount, workloadUid: null }, data: { state: SkillWorkloadState.Assigned, workloadUid: command.workloadUid } });
		if (updated.count !== 1) return "conflict";
		await this.transaction.skillWorkloadBootstrap.create({ data: { skillWorkloadId: workloadId, referenceHash: await __HashSkillWorkloadBootstrapReference(command.bootstrapReference), audience: TOOL_RUNNER_PROJECTED_TOKEN_AUDIENCE, serviceAccountName: TOOL_RUNNER_SERVICE_ACCOUNT_NAME, namespace: command.namespace, workloadUid: command.workloadUid } });
		return "assigned";
	}

	/** Reads the current time from the `skill_authority_clock` view, never from this process. */
	private async _databaseNow(): Promise<Date>
	{
		const clock = await this.transaction.skillAuthorityClock.findUnique({ where: { singleton: 1 } });
		if (clock === null || Number.isNaN(clock.now.getTime())) throw new Error("skill workload database clock unavailable");
		return clock.now;
	}
}

/** Checks every field of the command before any database row is read. */
async function _IsAssignmentCommandValid(workloadId: string, command: SkillWorkloadAssignmentCommand): Promise<boolean>
{
	return workloadId.length > 0 && command.workloadUid.length > 0 && /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(command.namespace) && command.namespace.length <= 63 && command.bootstrapReference === await __CreateSkillWorkloadBootstrapReference(workloadId) && Number.isSafeInteger(command.deliveryCount) && command.deliveryCount >= 1 && Number.isFinite(Date.parse(command.claimedAt));
}

/** Returns whether the protected retained controller may still assign this published tool-runner workload. */
function _IsEligibleRevisionForKind(kind: SkillWorkloadKind, state: SkillRevisionState): boolean
{
	return kind === SkillWorkloadKind.ToolRunner && state === SkillRevisionState.Published;
}
