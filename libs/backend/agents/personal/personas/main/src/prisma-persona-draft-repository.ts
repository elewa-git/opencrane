import { Prisma, type PrismaClient } from "@prisma/client";

import type { CreatePersonaDraftCommand, CreatePersonaDraftPersistenceResult, PersonaDraftRepository } from "./persona-draft-authority.types.js";

/** Prisma authority that derives a draft persona only from one locked completed interview. */
export class PrismaPersonaDraftRepository implements PersonaDraftRepository
{
	/** Canonical per-silo product database. */
	private readonly prisma: PrismaClient;

	/** Create the draft authority over the canonical product database. */
	constructor(prisma: PrismaClient)
	{
		this.prisma = prisma;
	}

	/** Lock source evidence, derive the winning template, and persist the next reviewable revision. */
	async createAtomically(command: CreatePersonaDraftCommand): Promise<CreatePersonaDraftPersistenceResult>
	{
		try
		{
			return await this.prisma.$transaction(async function _create(transaction)
			{
				// 1. Lock the owner profile to serialize both revision numbering and its immutable lineage.
				const profiles = await transaction.$queryRaw<readonly { readonly activeRevisionId: string | null }[]>(Prisma.sql`SELECT "active_revision_id" AS "activeRevisionId" FROM "persona_profiles" WHERE "id" = ${command.personaProfileId} AND "silo_id" = ${command.siloId} AND "user_id" = ${command.userId} FOR UPDATE`);
				if (profiles.length !== 1) return { status: "not_found_or_wrong_owner" } as const;

				// 2. Lock the completed interview so selected answers and the next draft share one exact evidence view.
				const interviews = await transaction.$queryRaw<readonly { readonly id: string }[]>(Prisma.sql`SELECT "id" FROM "persona_interviews" WHERE "id" = ${command.interviewId} AND "persona_profile_id" = ${command.personaProfileId} AND "user_id" = ${command.userId} AND "state" = 'completed' FOR UPDATE`);
				if (interviews.length !== 1) return { status: "interview_incomplete" } as const;

				// 3. Derive the deterministic winning reviewed SOUL template and validate every proposed insight answer.
				const template = await _selectedTemplate(transaction, command.interviewId);
				if (template === null) return { status: "template_not_selected" } as const;
				const evidence = await _insightEvidence(transaction, command);
				if (evidence === null) return { status: "invalid_insights" } as const;

				// 4. Allocate the next profile-local revision, then store only the derived template and evidence coordinates.
				const revisions = await transaction.$queryRaw<readonly { readonly nextRevision: number }[]>(Prisma.sql`SELECT COALESCE(MAX("revision"), 0) + 1 AS "nextRevision" FROM "persona_revisions" WHERE "persona_profile_id" = ${command.personaProfileId}`);
				const revision = await transaction.personaRevision.create({ data: { personaProfileId: command.personaProfileId, revision: revisions[0]?.nextRevision ?? 1, soulTemplateId: template.templateId, soulTemplateVersion: template.templateVersion, soulTemplateDigest: template.templateDigest, interviewId: command.interviewId, selectionRuleId: template.selectionRuleId, selectionAnswerIds: [...template.selectionAnswerIds], compiledInstructions: _compiledInstructions(template.content, command.insights), previousRevisionId: profiles[0].activeRevisionId, authoredBy: command.userId, createdAt: new Date(command.authoredAt) }, select: { id: true } });
				await transaction.personaInsight.createMany({ data: evidence.map(function _toInsight(item) { return { personaRevisionId: revision.id, category: item.category, statement: item.statement, interviewId: command.interviewId, questionSetId: item.questionSetId, questionSetVersion: item.questionSetVersion, questionId: item.questionId, answerId: item.answerId }; }) });
				return { status: "created", personaRevisionId: revision.id } as const;
			});
		}
		catch (error)
		{
			if (error instanceof Prisma.PrismaClientKnownRequestError) return { status: "conflict" };
			return { status: "persistence_unavailable" };
		}
	}
}

/** Load Postgres's same deterministic selected-template candidate that the approval trigger enforces. */
async function _selectedTemplate(transaction: Prisma.TransactionClient, interviewId: string): Promise<{ readonly templateId: string; readonly templateVersion: number; readonly templateDigest: string; readonly content: string; readonly selectionRuleId: string; readonly selectionAnswerIds: readonly string[] } | null>
{
	const rows = await transaction.$queryRaw<readonly { readonly templateId: string; readonly templateVersion: number; readonly templateDigest: string; readonly content: string; readonly selectionRuleId: string; readonly selectionAnswerIds: readonly string[] }[]>(Prisma.sql`
		SELECT template."template_id" AS "templateId", template."version" AS "templateVersion", template."digest" AS "templateDigest", template."content", rule ->> 'id' AS "selectionRuleId",
			ARRAY(SELECT answer."id" FROM jsonb_object_keys(rule -> 'answers') required_question_id JOIN "persona_interview_answers" answer ON answer."interview_id" = ${interviewId} AND answer."question_id" = required_question_id ORDER BY answer."id") AS "selectionAnswerIds"
		FROM "persona_soul_templates" template CROSS JOIN LATERAL jsonb_array_elements(template."selection_rules") rule
		WHERE NOT EXISTS (SELECT 1 FROM jsonb_each_text(rule -> 'answers') required_answer WHERE NOT EXISTS (SELECT 1 FROM "persona_interview_answers" answer WHERE answer."interview_id" = ${interviewId} AND answer."question_id" = required_answer.key AND answer."value" = required_answer.value))
		ORDER BY (rule ->> 'priority')::INTEGER DESC, template."template_id", template."version" DESC, "selectionRuleId" LIMIT 1`);
	return rows[0] ?? null;
}

/** Return exact persisted question provenance for each proposed insight answer, or null on any mismatch. */
async function _insightEvidence(transaction: Prisma.TransactionClient, command: CreatePersonaDraftCommand): Promise<readonly { readonly answerId: string; readonly statement: string; readonly category: "RelationshipRole" | "ToneLanguage" | "AnswerStructure" | "ChallengeSupport" | "Initiative" | "ApprovalRisk" | "WorkingHabits" | "MemoryBoundaries"; readonly questionSetId: string; readonly questionSetVersion: number; readonly questionId: string }[] | null>
{
	const answerIds = command.insights.map(function _answerId(insight) { return insight.answerId; });
	const rows = await transaction.$queryRaw<readonly { readonly answerId: string; readonly category: "RelationshipRole" | "ToneLanguage" | "AnswerStructure" | "ChallengeSupport" | "Initiative" | "ApprovalRisk" | "WorkingHabits" | "MemoryBoundaries"; readonly questionSetId: string; readonly questionSetVersion: number; readonly questionId: string }[]>(Prisma.sql`SELECT answer."id" AS "answerId", question."category", answer."question_set_id" AS "questionSetId", answer."question_set_version" AS "questionSetVersion", answer."question_id" AS "questionId" FROM "persona_interview_answers" answer JOIN "persona_questions" question ON question."question_set_id" = answer."question_set_id" AND question."question_set_version" = answer."question_set_version" AND question."question_id" = answer."question_id" WHERE answer."interview_id" = ${command.interviewId} AND answer."id" IN (${Prisma.join(answerIds)})`);
	if (rows.length !== command.insights.length) return null;
	const evidence = new Map(rows.map(function _byAnswer(item) { return [item.answerId, item]; }));
	return command.insights.map(function _toEvidence(insight)
	{
		const row = evidence.get(insight.answerId);
		return row === undefined ? null : { ...row, statement: insight.statement };
	}).every(function _isPresent(item) { return item !== null; }) ? command.insights.map(function _toExactEvidence(insight) { const row = evidence.get(insight.answerId); return { ...row!, statement: insight.statement }; }) : null;
}

/** Compile the reviewed SOUL source and explicit owner-visible interview insights into draft instructions. */
function _compiledInstructions(templateContent: string, insights: readonly { readonly statement: string }[]): string
{
	return `${templateContent.trim()}\n\n## Interview insights\n${insights.map(function _renderInsight(insight) { return `- ${insight.statement.trim()}`; }).join("\n")}\n`;
}
