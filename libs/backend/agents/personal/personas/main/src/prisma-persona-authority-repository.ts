import { PersonaInterviewState, PersonaRevisionState, Prisma, type PrismaClient } from "@prisma/client";

import type { ApprovePersonaCommand, AtomicApprovePersonaCommand, AtomicApprovePersonaResult, PersonaApprovalSnapshot, PersonaAuthorityRepository } from "./persona-authority.types.js";

/** Prisma-backed authority that atomically approves and activates one personal persona revision. */
export class PrismaPersonaAuthorityRepository implements PersonaAuthorityRepository
{
	/** Canonical per-silo product database. */
	private readonly prisma: PrismaClient;

	/** Create the authority over the canonical product database. */
	constructor(prisma: PrismaClient)
	{
		this.prisma = prisma;
	}

	/** Load the exact approval evidence required before an owner may activate a persona draft. */
	async getApprovalSnapshot(command: ApprovePersonaCommand): Promise<PersonaApprovalSnapshot | null>
	{
		const revision = await this.prisma.personaRevision.findFirst({
			where: { id: command.personaRevisionId, personaProfileId: command.personaProfileId },
			select: {
				state: true,
				personaProfileId: true,
				soulTemplateDigest: true,
				durableSoulMutationPolicy: true,
				profile: { select: { userId: true } },
				interview: { select: { state: true } },
				soulTemplate: { select: { digest: true } },
				_count: { select: { insights: true } },
			},
		});
		if (revision === null) return null;

		// The target-baseline trigger remains the commit authority; this query gives callers a precise preflight denial.
		const templateSelectionMatches = await this._matchesSelectedTemplate(command.personaRevisionId);
		return {
			profileUserId: revision.profile.userId,
			revisionState: revision.state === PersonaRevisionState.Draft ? "draft" : "approved",
			revisionProfileId: revision.personaProfileId,
			interviewState: _asInterviewState(revision.interview.state),
			insightCount: revision._count.insights,
			templateDigestMatches: revision.soulTemplate.digest === revision.soulTemplateDigest,
			templateSelectionMatches,
			durableSoulMutationPolicy: revision.durableSoulMutationPolicy,
		};
	}

	/** Approve a still-valid draft and move its profile pointer while holding the profile lock. */
	async approveAndActivateAtomically(command: AtomicApprovePersonaCommand): Promise<AtomicApprovePersonaResult>
	{
		try
		{
			return await this.prisma.$transaction(async function _approve(transaction)
			{
				// 1. Lock the profile so two valid drafts cannot race to become the active persona.
				const profiles = await transaction.$queryRaw<readonly { readonly id: string }[]>(Prisma.sql`SELECT "id" FROM "persona_profiles" WHERE "id" = ${command.personaProfileId} AND "user_id" = ${command.userId} FOR UPDATE`);
				if (profiles.length !== 1) return { status: "not_found" } as const;

				// 2. Lock the draft revision before inspecting its evidence, matching the lock used by the insight-provenance trigger.
				const revisions = await transaction.$queryRaw<readonly { readonly id: string }[]>(Prisma.sql`SELECT "id" FROM "persona_revisions" WHERE "id" = ${command.personaRevisionId} AND "persona_profile_id" = ${command.personaProfileId} AND "state" = 'draft' FOR UPDATE`);
				if (revisions.length !== 1) return { status: "conflict" } as const;

				// 3. Rebind the exact evidence count accepted at preflight; a valid extra insight still changes the reviewed draft.
				const insightCount = await transaction.personaInsight.count({ where: { personaRevisionId: command.personaRevisionId } });
				if (insightCount !== command.expectedInsightCount) return { status: "conflict" } as const;

				// 4. The baseline trigger rechecks interview, template, and insight evidence at this mutation fence.
				const revision = await transaction.personaRevision.updateMany({
					where: { id: command.personaRevisionId, personaProfileId: command.personaProfileId, state: PersonaRevisionState.Draft },
					data: { state: PersonaRevisionState.Approved, approvedBy: command.userId, approvedAt: new Date(command.approvedAt) },
				});
				if (revision.count !== 1) return { status: "conflict" } as const;

				// 5. Point the same locked profile at the newly approved revision; its trigger rejects an invalid target.
				const profile = await transaction.personaProfile.updateMany({
					where: { id: command.personaProfileId, userId: command.userId },
					data: { activeRevisionId: command.personaRevisionId },
				});
				return profile.count === 1 ? { status: "approved" } as const : { status: "conflict" } as const;
			});
		}
		catch (error)
		{
			if (error instanceof Prisma.PrismaClientKnownRequestError) return { status: "conflict" };
			throw error;
		}
	}

	/** Ask Postgres whether this revision still pins the deterministic winning template and answer set. */
	private async _matchesSelectedTemplate(personaRevisionId: string): Promise<boolean>
	{
		const rows = await this.prisma.$queryRaw<readonly { readonly matches: boolean | null }[]>(Prisma.sql`
			SELECT (
				revision."soul_template_id" IS NOT DISTINCT FROM candidate."template_id"
				AND revision."soul_template_version" IS NOT DISTINCT FROM candidate."version"
				AND revision."soul_template_digest" IS NOT DISTINCT FROM candidate."digest"
				AND revision."selection_rule_id" IS NOT DISTINCT FROM candidate."rule_id"
				AND ARRAY(SELECT answer_id FROM unnest(revision."selection_answer_ids") answer_id ORDER BY answer_id) IS NOT DISTINCT FROM candidate."answer_ids"
			) AS "matches"
			FROM "persona_revisions" revision
			LEFT JOIN LATERAL (
				SELECT template."template_id", template."version", template."digest", rule ->> 'id' AS "rule_id",
					ARRAY(
						SELECT answer."id" FROM jsonb_object_keys(rule -> 'answers') required_question_id
						JOIN "persona_interview_answers" answer ON answer."interview_id" = revision."interview_id" AND answer."question_id" = required_question_id
						ORDER BY answer."id"
					) AS "answer_ids", (rule ->> 'priority')::INTEGER AS "priority"
				FROM "persona_soul_templates" template CROSS JOIN LATERAL jsonb_array_elements(template."selection_rules") rule
				WHERE NOT EXISTS (
					SELECT 1 FROM jsonb_each_text(rule -> 'answers') required_answer
					WHERE NOT EXISTS (
						SELECT 1 FROM "persona_interview_answers" answer
						WHERE answer."interview_id" = revision."interview_id" AND answer."question_id" = required_answer.key AND answer."value" = required_answer.value
					)
				)
				ORDER BY "priority" DESC, template."template_id", template."version" DESC, "rule_id" LIMIT 1
			) candidate ON TRUE WHERE revision."id" = ${personaRevisionId}`);
		return rows[0]?.matches === true;
	}
}

/** Convert Prisma's closed interview enum into the domain approval vocabulary. */
function _asInterviewState(state: PersonaInterviewState): "in_progress" | "completed" | "retaken"
{
	if (state === PersonaInterviewState.Completed) return "completed";
	if (state === PersonaInterviewState.Retaken) return "retaken";
	return "in_progress";
}
