import { PersonaRevisionState, Prisma, type PrismaClient } from "@prisma/client";

import type { AtomicApprovePersonaCommand, AtomicApprovePersonaResult, ApprovePersonaCommand, PersonaApprovalSnapshot, PersonaAuthorityRepository } from "./persona-authority.types.js";
import type { PersonaInterviewAuthorityRow, PersonaProfileAuthorityRow, PersonaRevisionAuthorityRow, PersonaTemplateSelectionCandidate } from "./prisma-persona-authority.types.js";

/** Prisma authority adapter that approves only a fully evidenced immutable persona revision. */
export class PrismaPersonaAuthorityRepository implements PersonaAuthorityRepository
{
	/** Canonical product database authority. */
	private readonly prisma: PrismaClient;

	/** Creates the persona approval persistence adapter. */
	constructor(prisma: PrismaClient)
	{
		this.prisma = prisma;
	}

	/** Loads the approval evidence under the same locks used by the eventual write. */
	async getApprovalSnapshot(command: ApprovePersonaCommand): Promise<PersonaApprovalSnapshot | null>
	{
		return this.prisma.$transaction(async function _read(transaction: Prisma.TransactionClient)
		{
			return _LoadApprovalSnapshot(transaction, command);
		});
	}

	/** Revalidates every approval precondition and advances the active revision in one transaction. */
	async approveAndActivateAtomically(command: AtomicApprovePersonaCommand): Promise<AtomicApprovePersonaResult>
	{
		return this.prisma.$transaction(async function _approve(transaction: Prisma.TransactionClient)
		{
			// 1. Lock and re-read all mutable evidence so a concurrent draft edit cannot be approved.
			const snapshot = await _LoadApprovalSnapshot(transaction, command);
			if (snapshot === null) return { status: "not_found" };
			if (!_MatchesApprovalPreconditions(snapshot, command)) return { status: "conflict" };

			// 2. Promote the exact draft before updating the profile because its foreign-key gate requires approval.
			const revision = await transaction.personaRevision.updateMany({
				where: { id: command.personaRevisionId, personaProfileId: command.personaProfileId, state: PersonaRevisionState.Draft },
				data: { state: PersonaRevisionState.Approved, approvedBy: command.userId, approvedAt: new Date(command.approvedAt) },
			});
			if (revision.count !== 1) return { status: "conflict" };

			// 3. Move the profile pointer while its row remains locked, preserving one active approved revision.
			await transaction.personaProfile.update({ where: { id: command.personaProfileId }, data: { activeRevisionId: command.personaRevisionId } });
			return { status: "approved" };
		});
	}
}

/** Loads all decision evidence in the profile → revision → interview lock order. */
async function _LoadApprovalSnapshot(transaction: Prisma.TransactionClient, command: ApprovePersonaCommand): Promise<PersonaApprovalSnapshot | null>
{
	// 1. Lock the profile first because it owns both the user authority and active pointer.
	const profiles = await transaction.$queryRaw<PersonaProfileAuthorityRow[]>(Prisma.sql`SELECT "id", "user_id" AS "userId" FROM "persona_profiles" WHERE "id" = ${command.personaProfileId} FOR UPDATE`);
	const profile = profiles[0];
	if (profile === undefined) return null;

	// 2. Lock the candidate revision second so insight writes and approval cannot interleave.
	const revisions = await transaction.$queryRaw<PersonaRevisionAuthorityRow[]>(Prisma.sql`SELECT "id", "persona_profile_id" AS "personaProfileId", "state", "interview_id" AS "interviewId", "soul_template_id" AS "soulTemplateId", "soul_template_version" AS "soulTemplateVersion", "soul_template_digest" AS "soulTemplateDigest", "selection_rule_id" AS "selectionRuleId", "selection_answer_ids" AS "selectionAnswerIds", "durable_soul_mutation_policy" AS "durableSoulMutationPolicy" FROM "persona_revisions" WHERE "id" = ${command.personaRevisionId} FOR UPDATE`);
	const revision = revisions[0];
	if (revision === undefined) return null;

	// 3. Lock the interview last because completed answer evidence determines template selection.
	const interviews = await transaction.$queryRaw<PersonaInterviewAuthorityRow[]>(Prisma.sql`SELECT "state" FROM "persona_interviews" WHERE "id" = ${revision.interviewId} FOR UPDATE`);
	const interview = interviews[0];
	if (interview === undefined) return null;

	// 4. Read immutable template and answer provenance after locks make the draft evidence stable.
	const insightCount = await transaction.personaInsight.count({ where: { personaRevisionId: revision.id } });
	const candidates = await transaction.$queryRaw<PersonaTemplateSelectionCandidate[]>(Prisma.sql`
		SELECT candidate."template_id" AS "templateId", candidate."version" AS "templateVersion", candidate."digest" AS "templateDigest", candidate."rule_id" AS "ruleId", candidate."answer_ids" AS "answerIds"
		FROM (
			SELECT template."template_id", template."version", template."digest", rule ->> 'id' AS "rule_id",
				ARRAY(SELECT answer."id" FROM jsonb_object_keys(rule -> 'answers') required_question_id JOIN "persona_interview_answers" answer ON answer."interview_id" = ${revision.interviewId} AND answer."question_id" = required_question_id ORDER BY answer."id") AS "answer_ids",
				(rule ->> 'priority')::INTEGER AS "priority"
			FROM "persona_soul_templates" template CROSS JOIN LATERAL jsonb_array_elements(template."selection_rules") rule
			WHERE NOT EXISTS (SELECT 1 FROM jsonb_each_text(rule -> 'answers') required_answer WHERE NOT EXISTS (SELECT 1 FROM "persona_interview_answers" answer WHERE answer."interview_id" = ${revision.interviewId} AND answer."question_id" = required_answer.key AND answer."value" = required_answer.value))
			ORDER BY "priority" DESC, template."template_id", template."version" DESC, "rule_id" LIMIT 1
		) candidate
	`);
	const candidate = candidates[0];

	return {
		profileUserId: profile.userId,
		revisionState: revision.state,
		revisionProfileId: revision.personaProfileId,
		interviewState: interview.state,
		insightCount,
		templateDigestMatches: candidate !== undefined && candidate.templateId === revision.soulTemplateId && candidate.templateVersion === revision.soulTemplateVersion && candidate.templateDigest === revision.soulTemplateDigest,
		templateSelectionMatches: candidate !== undefined && candidate.ruleId === revision.selectionRuleId && _SameAnswerIds(candidate.answerIds, revision.selectionAnswerIds),
		durableSoulMutationPolicy: revision.durableSoulMutationPolicy,
	};
}

/** Compares evidence sets without trusting their persisted insertion order. */
function _SameAnswerIds(left: readonly string[], right: readonly string[]): boolean
{
	return left.length === right.length && [...left].sort().every(function _matches(value, index) { return value === [...right].sort()[index]; });
}

/** Confirms every predicate accepted by the use case still holds inside the write transaction. */
function _MatchesApprovalPreconditions(snapshot: PersonaApprovalSnapshot, command: AtomicApprovePersonaCommand): boolean
{
	return snapshot.profileUserId === command.userId
		&& snapshot.revisionProfileId === command.personaProfileId
		&& snapshot.revisionState === command.expectedRevisionState
		&& snapshot.interviewState === command.expectedInterviewState
		&& snapshot.insightCount === command.expectedInsightCount
		&& snapshot.insightCount >= 3
		&& snapshot.insightCount <= 5
		&& snapshot.templateDigestMatches
		&& snapshot.templateSelectionMatches
		&& snapshot.durableSoulMutationPolicy === "forbidden"
		&& Number.isFinite(Date.parse(command.approvedAt));
}
