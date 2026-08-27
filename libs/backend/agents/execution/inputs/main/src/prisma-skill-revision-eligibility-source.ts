import type { Prisma } from "@prisma/client";

import type { InitialRunAuthority, RunAdmissionTransaction } from "@opencrane/backend/agents/execution/runs";

import type { AssignedSkillRevision, SessionAssemblyCommand, SessionAssemblyLoad, SkillRevisionEligibilityRead, SkillRevisionEligibilityRepository, SkillRevisionEligibilityRepositoryFactory, SkillRevisionEligibilitySource, ToolPolicyInput } from "./session-assembly.types";

/** Reads assigned skill revisions through typed Prisma delegates inside run admission. */
export class PrismaSkillRevisionEligibilityRepository implements SkillRevisionEligibilityRepository
{
	/** Run-admission transaction that owns every eligibility read. */
	private readonly prisma: Prisma.TransactionClient;

	/** Creates the skill reader inside the caller's transaction. */
	constructor(prisma: Prisma.TransactionClient)
	{
		this.prisma = prisma;
	}

	/** Loads every assigned revision and its current publication facts. */
	async load(agentRevisionId: string): Promise<SkillRevisionEligibilityRead>
	{
		const assignments = await this.prisma.agentRevisionSkillAssignment.findMany({
			where: { agentRevisionId },
			orderBy: { skillRevisionId: "asc" },
			select: { skillRevisionId: true },
		});
		const revisions = await this.prisma.skillRevision.findMany({
			where: { id: { in: assignments.map(function _RevisionId(assignment): string { return assignment.skillRevisionId; }) } },
			orderBy: { id: "asc" },
			select: { id: true, state: true, revokedAt: true, skill: { select: { siloId: true } } },
		});
		return {
			isComplete: revisions.length === assignments.length,
			revisions: revisions.map(function _AssignedRevision(revision): AssignedSkillRevision
		{
			return { skillRevisionId: revision.id, isPublished: revision.state === "Published", revokedAt: revision.revokedAt, siloId: revision.skill.siloId };
			}),
		};
	}
}

/**
 * Re-checks every skill assigned to the revision inside the admission transaction.
 *
 * The surrounding Serializable transaction makes a concurrent assignment or revocation conflict
 * with snapshot persistence, so this reader needs no handwritten SQL lock order.
 *
 * Returns no value — it exists only to refuse. Naming fewer skills than the revision assigns is
 * allowed (grants can narrow the set); naming one the revision never assigned, or naming one twice,
 * is not.
 *
 * Constructed by: `__CreateManagedRunAdmissionPort` and `__CreatePersonalRunAdmissionPort`
 * (execution/admission/main/src).
 *
 * @implements SkillRevisionEligibilitySource
 */
export class PrismaSkillRevisionEligibilitySource implements SkillRevisionEligibilitySource
{
	/** Builds a reader bound to the active admission transaction. */
	private readonly createRepository: SkillRevisionEligibilityRepositoryFactory;

	/** Creates the source around the transaction-scoped repository factory. */
	constructor(createRepository: SkillRevisionEligibilityRepositoryFactory)
	{
		this.createRepository = createRepository;
	}

	/** Refuses a partial, foreign, revoked, or otherwise non-published skill assignment before snapshot persistence. */
	async load(command: SessionAssemblyCommand, run: InitialRunAuthority, toolPolicy: ToolPolicyInput, transaction: RunAdmissionTransaction): Promise<SessionAssemblyLoad<null>>
	{
		// 1. Load immutable assignment ids, then resolve their current publication and revocation state.
		const repository = this.createRepository(transaction);
		const read = await repository.load(run.agentRevisionId);
		if (!read.isComplete)
			return { outcome: "denied", reason: "skill_unavailable" };
		const rows = read.revisions;

		// 2. Allow fewer skills than the revision assigns, but never one it never assigned, and never the same one twice.
		const assignedIds = rows.map(function _assignedId(row): string { return row.skillRevisionId; });
		const suppliedIds = [...toolPolicy.skillRevisionIds];
		if (new Set(suppliedIds).size !== suppliedIds.length || !suppliedIds.every(function _isAssigned(id): boolean { return assignedIds.includes(id); }))
			return { outcome: "denied", reason: "skill_unavailable" };

		// 3. Of the skills the tool policy named, accept only same-silo published revisions with no revokedAt; the snapshot then keeps exactly those ids.
		if (!rows.filter(function _isSupplied(row): boolean { return suppliedIds.includes(row.skillRevisionId); }).every(function _isEligible(row): boolean { return row.siloId === command.siloId && row.isPublished && row.revokedAt === null; }))
			return { outcome: "denied", reason: "skill_unavailable" };
		return { outcome: "loaded", value: null };
	}
}
