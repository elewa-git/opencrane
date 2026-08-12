import { Prisma } from "@prisma/client";
import type { InitialRunAuthority, RunAdmissionTransaction } from "@opencrane/backend/agents/execution/runs";

import type { SessionAssemblyCommand, SessionAssemblyLoad, SkillRevisionEligibilitySource, ToolPolicyInput } from "./session-assembly.types.js";

/**
 * Locks and re-checks every skill assigned to the revision, inside the admission transaction.
 *
 * Runs last among the input sources, so its locks are the newest ones held when the snapshot
 * commits. It locks skills and then revisions in the same order revocation does, so a skill revoked
 * while admission is running cannot slip into the snapshot.
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
	/** Refuses a partial, foreign, revoked, or otherwise non-published skill assignment before snapshot persistence. */
	async load(command: SessionAssemblyCommand, run: InitialRunAuthority, toolPolicy: ToolPolicyInput, transaction: RunAdmissionTransaction): Promise<SessionAssemblyLoad<null>>
	{
		// 1. Lock skills, then revisions, in the same order revocation does, so one of the two clearly finishes first and this snapshot sees the result.
		await transaction.prisma.$queryRaw(Prisma.sql`
			SELECT skill."id"
			FROM "agent_revision_skill_assignments" assignment
			JOIN "skill_revisions" revision ON revision."id" = assignment."skill_revision_id"
			JOIN "skills" skill ON skill."id" = revision."skill_id"
			WHERE assignment."agent_revision_id" = ${run.agentRevisionId}
			ORDER BY skill."id"
			FOR UPDATE OF skill
		`);
		const rows = await transaction.prisma.$queryRaw<readonly _AssignedSkillRevision[]>(Prisma.sql`
			SELECT assignment."skill_revision_id" AS "skillRevisionId", revision."state" = 'published'::"SkillRevisionState" AS "isPublished", revision."revoked_at" AS "revokedAt", skill."silo_id" AS "siloId"
			FROM "agent_revision_skill_assignments" assignment
			JOIN "skill_revisions" revision ON revision."id" = assignment."skill_revision_id"
			JOIN "skills" skill ON skill."id" = revision."skill_id"
			WHERE assignment."agent_revision_id" = ${run.agentRevisionId}
			ORDER BY revision."id"
			FOR UPDATE OF revision
		`);
		await transaction.prisma.$queryRaw(Prisma.sql`
			SELECT assignment."agent_revision_id"
			FROM "agent_revision_skill_assignments" assignment
			WHERE assignment."agent_revision_id" = ${run.agentRevisionId}
			ORDER BY assignment."skill_revision_id"
			FOR UPDATE OF assignment
		`);

		// 2. Allow fewer skills than the revision assigns, but never one it never assigned, and never the same one twice.
		const assignedIds = rows.map(function _assignedId(row): string { return row.skillRevisionId; });
		const suppliedIds = [...toolPolicy.skillRevisionIds];
		if (new Set(suppliedIds).size !== suppliedIds.length || !suppliedIds.every(function _isAssigned(id): boolean { return assignedIds.includes(id); })) return { outcome: "denied", reason: "skill_unavailable" };

		// 3. Of the skills the tool policy named, accept only same-silo published revisions with no revokedAt; the snapshot then keeps exactly those ids.
		if (!rows.filter(function _isSupplied(row): boolean { return suppliedIds.includes(row.skillRevisionId); }).every(function _isEligible(row): boolean { return row.siloId === command.siloId && row.isPublished && row.revokedAt === null; })) return { outcome: "denied", reason: "skill_unavailable" };
		return { outcome: "loaded", value: null };
	}
}

/** One row from the locking query above: a skill assignment plus the fields it is checked against. */
interface _AssignedSkillRevision
{
	/** Immutable SkillRevision assigned to the published AgentRevision. */
	readonly skillRevisionId: string;
	/** Whether the locked revision's state is `published`, as computed by the query. */
	readonly isPublished: boolean;
	/** Server-owned revocation instant, if the revision has been withdrawn. */
	readonly revokedAt: Date | null;
	/** Silo of the skill that owns this revision. */
	readonly siloId: string;
}
