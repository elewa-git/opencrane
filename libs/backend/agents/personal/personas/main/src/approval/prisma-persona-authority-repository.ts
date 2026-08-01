import { PersonaInterviewState, PersonaRevisionState, Prisma, type PrismaClient } from "@prisma/client";

import type { PersonalConfigurationPersonaRefreshUnitOfWork } from "@opencrane/backend/agents/personal/configuration";

import { PersonaApprovalInterviewStates, PersonaApprovalPersistenceStatuses, PersonaApprovalRevisionStates, type ApprovePersonaCommand, type AtomicApprovePersonaCommand, type AtomicApprovePersonaResult, type PersonaApprovalSnapshot, type PersonaAuthorityRepository } from "./persona-authority.types.js";

/** Prisma-backed authority that atomically approves and activates one personal persona revision. */
export class PrismaPersonaAuthorityRepository implements PersonaAuthorityRepository
{
	/** Canonical per-silo product database. */
	private readonly prisma: PrismaClient;
	/** Configuration-owned atomic boundary for a proposal-bound persona approval. */
	private readonly refreshes: PersonalConfigurationPersonaRefreshUnitOfWork;

	/** Create the authority over the canonical product database. */
	constructor(prisma: PrismaClient, refreshes: PersonalConfigurationPersonaRefreshUnitOfWork)
	{
		this.prisma = prisma;
		this.refreshes = refreshes;
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
			revisionState: revision.state === PersonaRevisionState.Draft ? PersonaApprovalRevisionStates.Draft : PersonaApprovalRevisionStates.Approved,
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
			return await this.refreshes.runPersonaRefresh(async function _approve(transaction, refreshes)
			{
				const client = transaction as Prisma.TransactionClient;
				// 1. Lock the profile so two valid drafts cannot race to become the active persona.
				const profiles = await client.$queryRaw<readonly { readonly id: string; readonly siloId: string }[]>(Prisma.sql`SELECT "id", "silo_id" AS "siloId" FROM "persona_profiles" WHERE "id" = ${command.personaProfileId} AND "user_id" = ${command.userId} FOR UPDATE`);
				if (profiles.length !== 1) return { status: PersonaApprovalPersistenceStatuses.NotFound } as const;
				const profile = profiles[0];
				if (profile === undefined) return { status: PersonaApprovalPersistenceStatuses.NotFound } as const;

				// 2. Lock the draft revision before inspecting its evidence, matching the lock used by the insight-provenance trigger.
				const revisions = await client.$queryRaw<readonly { readonly id: string; readonly interviewId: string }[]>(Prisma.sql`SELECT "id", "interview_id" AS "interviewId" FROM "persona_revisions" WHERE "id" = ${command.personaRevisionId} AND "persona_profile_id" = ${command.personaProfileId} AND "state" = 'draft' FOR UPDATE`);
				if (revisions.length !== 1) return { status: PersonaApprovalPersistenceStatuses.Conflict } as const;
				const revision = revisions[0];
				if (revision === undefined) return { status: PersonaApprovalPersistenceStatuses.Conflict } as const;
				const interview = await client.personaInterview.findUnique({ where: { id: revision.interviewId }, select: { refreshConfigurationChangeId: true } });
				if (interview === null) return { status: PersonaApprovalPersistenceStatuses.Conflict } as const;

				// 3. Rebind the exact evidence count accepted at preflight; a valid extra insight still changes the reviewed draft.
				const insightCount = await client.personaInsight.count({ where: { personaRevisionId: command.personaRevisionId } });
				if (insightCount !== command.expectedInsightCount) return { status: PersonaApprovalPersistenceStatuses.Conflict } as const;

				// 4. The baseline trigger rechecks interview, template, and insight evidence at this mutation fence.
				const approvedRevision = await client.personaRevision.updateMany({
					where: { id: command.personaRevisionId, personaProfileId: command.personaProfileId, state: PersonaRevisionState.Draft },
					data: { state: PersonaRevisionState.Approved, approvedBy: command.userId, approvedAt: new Date(command.approvedAt) },
				});
				if (approvedRevision.count !== 1) return { status: PersonaApprovalPersistenceStatuses.Conflict } as const;

				// 5. Point the same locked profile at the newly approved revision; its trigger rejects an invalid target.
				const activatedProfile = await client.personaProfile.updateMany({
					where: { id: command.personaProfileId, userId: command.userId },
					data: { activeRevisionId: command.personaRevisionId },
				});
				if (activatedProfile.count !== 1) throw new _PersonaApprovalConflict();

				// 6. Apply only the refresh proposal that the completed interview carries; unrelated accepted proposals remain pending.
				if (interview.refreshConfigurationChangeId === null) return { status: PersonaApprovalPersistenceStatuses.Approved } as const;
				const applied = await refreshes.applyApprovedPersonaRefresh({ configurationChangeId: interview.refreshConfigurationChangeId, siloId: profile.siloId, userId: command.userId, personaProfileId: command.personaProfileId, personaRevisionId: command.personaRevisionId });
				if (!applied) throw new _PersonaApprovalConflict();
				return { status: PersonaApprovalPersistenceStatuses.Approved } as const;
			});
		}
		catch (error)
		{
			if (error instanceof _PersonaApprovalConflict || error instanceof Prisma.PrismaClientKnownRequestError) return { status: PersonaApprovalPersistenceStatuses.Conflict };
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

/** Abort a transaction after an approval mutation when a later required mutation cannot commit. */
class _PersonaApprovalConflict extends Error
{
}

/** Convert Prisma's closed interview enum into the domain approval vocabulary. */
function _asInterviewState(state: PersonaInterviewState): PersonaApprovalInterviewStates
{
	if (state === PersonaInterviewState.Completed) return PersonaApprovalInterviewStates.Completed;
	return PersonaApprovalInterviewStates.InProgress;
}
