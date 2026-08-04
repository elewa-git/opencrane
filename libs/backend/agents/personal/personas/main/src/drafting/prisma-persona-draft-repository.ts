import { Prisma } from "@prisma/client";
import type { Logger } from "@opencrane/observability";

import { _DoPersonaPersistenceWithTrace } from "../persona-persistence-observability.js";
import { PersonaLifecycleOutcomes } from "../profile/persona-lifecycle.types.js";
import type { PersonaPersistenceUnitOfWork } from "../profile/persona-persistence-unit-of-work.types.js";

import { PersonaDraftDenialReasons, type CreatePersonaDraftCommand, type CreatePersonaDraftPersistenceResult, type PersonaDraftFromInterviewRepository } from "./persona-draft-authority.types.js";
import type { PersonaDraftInsightEvidence, PersonaDraftInterviewLock, PersonaDraftProfileLock, PersonaDraftSelectedTemplate } from "./persona-draft-persistence.types.js";

/** Prisma authority that creates a draft from one locked, completed owner interview. */
export class PrismaPersonaDraftRepository implements PersonaDraftFromInterviewRepository
{
	/** App-owned structured logger for handled persistence failures. */
	private readonly logger: Logger;
	/** Persona-owned transaction boundary for the complete draft operation. */
	private readonly transactions: PersonaPersistenceUnitOfWork;

	/** Create the draft authority over the persona transaction boundary. */
	constructor(logger: Logger, transactions: PersonaPersistenceUnitOfWork)
	{
		this.logger = logger;
		this.transactions = transactions;
	}

	/** Lock the owner evidence, derive its bounded insights, and persist one reviewable revision. */
	async createFromInterviewAtomically(command: CreatePersonaDraftCommand): Promise<CreatePersonaDraftPersistenceResult>
	{
		const repository = this;
		const transactions = this.transactions;
		try
		{
			return await _DoPersonaPersistenceWithTrace(this.logger, "persona.draft.create", { siloId: command.siloId, userId: command.userId, personaProfileId: command.personaProfileId, interviewId: command.interviewId }, "Persona draft persistence failed", async function _traceCreate()
			{
				return transactions.run(async function _create(transaction)
				{
					return repository._createDraft(transaction as Prisma.TransactionClient, command);
				});
			}, _IsDraftConflict);
		}
		catch (error)
		{
			if (_IsDraftConflict(error)) return { status: PersonaDraftDenialReasons.Conflict };
			return { status: PersonaDraftDenialReasons.PersistenceUnavailable };
		}
	}

	/** Execute the ordered draft invariants inside one serializable persona transaction. */
	private async _createDraft(transaction: Prisma.TransactionClient, command: CreatePersonaDraftCommand): Promise<CreatePersonaDraftPersistenceResult>
	{
		// 1. Lock the owner profile to serialize revision numbering and immutable lineage.
		const profile = await this._lockProfile(transaction, command);
		if (profile === null) return { status: PersonaDraftDenialReasons.NotFoundOrWrongOwner };

		// 2. Lock the completed interview so all derived evidence comes from one frozen view.
		const interview = await this._lockCompletedInterview(transaction, command);
		if (interview === null) return { status: PersonaDraftDenialReasons.InterviewIncomplete };

		// 3. Derive both the reviewed template and bounded insights from the locked interview.
		const template = await this._selectedTemplate(transaction, command.interviewId);
		if (template === null) return { status: PersonaDraftDenialReasons.TemplateNotSelected };
		const insights = await this._insightEvidence(transaction, interview, command.interviewId);
		if (insights === null) return { status: PersonaDraftDenialReasons.InvalidInsights };

		// 4. Allocate and persist the next profile-local revision with its exact evidence coordinates.
		return this._persistDraft(transaction, command, profile, template, insights);
	}

	/** Lock and return the exact owner profile, or null when the caller does not own it. */
	private async _lockProfile(transaction: Prisma.TransactionClient, command: CreatePersonaDraftCommand): Promise<PersonaDraftProfileLock | null>
	{
		const profiles = await transaction.$queryRaw<readonly PersonaDraftProfileLock[]>(Prisma.sql`SELECT "active_revision_id" AS "activeRevisionId" FROM "persona_profiles" WHERE "id" = ${command.personaProfileId} AND "silo_id" = ${command.siloId} AND "user_id" = ${command.userId} FOR UPDATE`);
		return profiles.length === 1 ? profiles[0] : null;
	}

	/** Lock and return the exact completed interview coordinates, or null when it is unavailable. */
	private async _lockCompletedInterview(transaction: Prisma.TransactionClient, command: CreatePersonaDraftCommand): Promise<PersonaDraftInterviewLock | null>
	{
		const interviews = await transaction.$queryRaw<readonly PersonaDraftInterviewLock[]>(Prisma.sql`SELECT "question_set_id" AS "questionSetId", "question_set_version" AS "questionSetVersion" FROM "persona_interviews" WHERE "id" = ${command.interviewId} AND "persona_profile_id" = ${command.personaProfileId} AND "user_id" = ${command.userId} AND "state" = 'completed' FOR UPDATE`);
		return interviews.length === 1 ? interviews[0] : null;
	}

	/** Load Postgres's same deterministic selected-template candidate that the approval trigger enforces. */
	private async _selectedTemplate(transaction: Prisma.TransactionClient, interviewId: string): Promise<PersonaDraftSelectedTemplate | null>
	{
		const rows = await transaction.$queryRaw<readonly PersonaDraftSelectedTemplate[]>(Prisma.sql`
			SELECT template."template_id" AS "templateId", template."version" AS "templateVersion", template."digest" AS "templateDigest", template."content", rule ->> 'id' AS "selectionRuleId",
				ARRAY(SELECT answer."id" FROM jsonb_object_keys(rule -> 'answers') required_question_id JOIN "persona_interview_answers" answer ON answer."interview_id" = ${interviewId} AND answer."question_id" = required_question_id ORDER BY answer."id") AS "selectionAnswerIds"
			FROM "persona_soul_templates" template CROSS JOIN LATERAL jsonb_array_elements(template."selection_rules") rule
			WHERE NOT EXISTS (SELECT 1 FROM jsonb_each_text(rule -> 'answers') required_answer WHERE NOT EXISTS (SELECT 1 FROM "persona_interview_answers" answer WHERE answer."interview_id" = ${interviewId} AND answer."question_id" = required_answer.key AND answer."value" = required_answer.value))
			ORDER BY (rule ->> 'priority')::INTEGER DESC, template."template_id", template."version" DESC, "selectionRuleId" LIMIT 1`);
		return rows[0] ?? null;
	}

	/** Derive three to five insights and exact question provenance from the locked interview. */
	private async _insightEvidence(transaction: Prisma.TransactionClient, interview: PersonaDraftInterviewLock, interviewId: string): Promise<readonly PersonaDraftInsightEvidence<Prisma.PersonaInsightCreateManyInput["category"]>[] | null>
	{
		const answers = await transaction.personaInterviewAnswer.findMany({ where: { interviewId, questionSetId: interview.questionSetId, questionSetVersion: interview.questionSetVersion }, select: { id: true, value: true, questionId: true }, orderBy: { id: "asc" }, take: 5 });
		if (answers.length < 3) return null;
		const questions = await transaction.personaQuestion.findMany({ where: { questionSetId: interview.questionSetId, questionSetVersion: interview.questionSetVersion, id: { in: answers.map(function _questionId(answer) { return answer.questionId; }) } }, select: { id: true, category: true } });
		if (questions.length !== answers.length) return null;
		const categories = new Map(questions.map(function _questionCategory(question) { return [question.id, question.category]; }));
		const insights: PersonaDraftInsightEvidence<Prisma.PersonaInsightCreateManyInput["category"]>[] = [];
		for (const answer of answers)
		{
			const category = categories.get(answer.questionId);
			if (category === undefined) return null;
			insights.push({ answerId: answer.id, statement: `Owner response: ${answer.value.trim()}`, category, questionSetId: interview.questionSetId, questionSetVersion: interview.questionSetVersion, questionId: answer.questionId });
		}
		return insights;
	}

	/** Allocate and write one draft revision plus its immutable insight evidence. */
	private async _persistDraft(transaction: Prisma.TransactionClient, command: CreatePersonaDraftCommand, profile: PersonaDraftProfileLock, template: PersonaDraftSelectedTemplate, insights: readonly PersonaDraftInsightEvidence<Prisma.PersonaInsightCreateManyInput["category"]>[]): Promise<CreatePersonaDraftPersistenceResult>
	{
		const revisions = await transaction.$queryRaw<readonly { readonly nextRevision: number }[]>(Prisma.sql`SELECT COALESCE(MAX("revision"), 0) + 1 AS "nextRevision" FROM "persona_revisions" WHERE "persona_profile_id" = ${command.personaProfileId}`);
		const revision = await transaction.personaRevision.create({ data: _revisionData(command, profile, template, insights, revisions[0]?.nextRevision ?? 1), select: { id: true } });
		await transaction.personaInsight.createMany({ data: insights.map(function _toInsightData(insight) { return _insightData(revision.id, command.interviewId, insight); }) });
		return { status: PersonaLifecycleOutcomes.Created, personaRevisionId: revision.id };
	}
}

/** Build the Prisma revision input from validated locked evidence. */
function _revisionData(command: CreatePersonaDraftCommand, profile: PersonaDraftProfileLock, template: PersonaDraftSelectedTemplate, insights: readonly PersonaDraftInsightEvidence<Prisma.PersonaInsightCreateManyInput["category"]>[], revision: number): Prisma.PersonaRevisionUncheckedCreateInput
{
	return { personaProfileId: command.personaProfileId, revision, soulTemplateId: template.templateId, soulTemplateVersion: template.templateVersion, soulTemplateDigest: template.templateDigest, interviewId: command.interviewId, selectionRuleId: template.selectionRuleId, selectionAnswerIds: [...template.selectionAnswerIds], compiledInstructions: _compiledInstructions(template.content, insights), previousRevisionId: profile.activeRevisionId, authoredBy: command.userId, createdAt: new Date(command.authoredAt) };
}

/** Build one Prisma insight input from server-derived answer provenance. */
function _insightData(personaRevisionId: string, interviewId: string, insight: PersonaDraftInsightEvidence<Prisma.PersonaInsightCreateManyInput["category"]>): Prisma.PersonaInsightCreateManyInput
{
	return { personaRevisionId, category: insight.category, statement: insight.statement, interviewId, questionSetId: insight.questionSetId, questionSetVersion: insight.questionSetVersion, questionId: insight.questionId, answerId: insight.answerId };
}

/** Recognise only concurrent unique-key and transaction-write races as draft conflicts. */
function _IsDraftConflict(error: unknown): boolean
{
	return error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2002" || error.code === "P2034");
}

/** Compile the reviewed SOUL source and server-derived interview insights into draft instructions. */
function _compiledInstructions(templateContent: string, insights: readonly PersonaDraftInsightEvidence<unknown>[]): string
{
	return `${templateContent.trim()}\n\n## Interview insights\n${insights.map(function _renderInsight(insight) { return `- ${insight.statement.trim()}`; }).join("\n")}\n`;
}
