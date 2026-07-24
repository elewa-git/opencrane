import { Prisma } from "@prisma/client";
import type { InitialRunAuthority, RunAdmissionTransaction } from "@opencrane/backend/agents/execution/runs";

import type { SessionAssemblyCommand, SessionAssemblyLoad, SkillRevisionEligibilitySource, ToolPolicyInput } from "./session-assembly.types.js";

/** Locks and rechecks every skill assigned to a revision at the final run-admission fence. */
export class PrismaSkillRevisionEligibilitySource implements SkillRevisionEligibilitySource
{
	/** Refuses a partial, foreign, revoked, or otherwise non-published skill assignment before snapshot persistence. */
	async load(command: SessionAssemblyCommand, run: InitialRunAuthority, toolPolicy: ToolPolicyInput, transaction: RunAdmissionTransaction): Promise<SessionAssemblyLoad<null>>
	{
		// 1. Lock skills then revisions in the same order as revocation, so one operation wins before a snapshot commits.
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

		// 2. Permit a grant-intersected subset, but never an invented, duplicate, or foreign skill revision.
		const assignedIds = rows.map(function _assignedId(row): string { return row.skillRevisionId; });
		const suppliedIds = [...toolPolicy.skillRevisionIds];
		if (new Set(suppliedIds).size !== suppliedIds.length || !suppliedIds.every(function _isAssigned(id): boolean { return assignedIds.includes(id); })) return { outcome: "denied", reason: "skill_unavailable" };

		// 3. Accept only supplied same-silo published revisions with no revocation marker, then preserve that exact evidence in the snapshot.
		if (!rows.filter(function _isSupplied(row): boolean { return suppliedIds.includes(row.skillRevisionId); }).every(function _isEligible(row): boolean { return row.siloId === command.siloId && row.isPublished && row.revokedAt === null; })) return { outcome: "denied", reason: "skill_unavailable" };
		return { outcome: "loaded", value: null };
	}
}

/** One locked agent-revision skill assignment returned by the admission-time authority query. */
interface _AssignedSkillRevision
{
	/** Immutable SkillRevision assigned to the published AgentRevision. */
	readonly skillRevisionId: string;
	/** Whether PostgreSQL evaluated the locked lifecycle state as published. */
	readonly isPublished: boolean;
	/** Server-owned revocation instant, if the revision has been withdrawn. */
	readonly revokedAt: Date | null;
	/** ClusterTenant scope of the logical skill owning this revision. */
	readonly siloId: string;
}
