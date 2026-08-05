import { Prisma } from "@prisma/client";
import { PersonaLifecycleOutcomes } from "../profile/persona-lifecycle.types.js";
import type { PersonaProfileRecord } from "../profile/persona-aggregate-read-repository.types.js";
import { PrismaPersonaAggregateReadRepository } from "../profile/prisma-persona-aggregate-read-repository.js";

import { PersonaDraftDenialReasons, type CreatePersonaDraftCommand, type CreatePersonaDraftPersistenceResult, type PersonaDraftFromInterviewRepository } from "./persona-draft-authority.types.js";
import { _CompilePersonaDraftInstructions } from "./persona-draft-instruction-compiler.js";
import type { PersonaDraftCompletedInterview, PersonaDraftInsightEvidence } from "./persona-draft-persistence.types.js";
import { PrismaPersonaDraftTemplateSelectorRepository } from "./prisma-persona-draft-template-selector.js";
import type { PersonaDraftTemplateSelection, PersonaDraftTemplateSelectorRepository } from "./persona-draft-template-selector.types.js";

/** Prisma authority that creates a draft from one completed owner interview snapshot. */
export class PrismaPersonaDraftRepository implements PersonaDraftFromInterviewRepository
{
	/** Transaction-scoped ORM client supplied only by the persona unit of work. */
	private readonly transaction: Prisma.TransactionClient;
	/** Aggregate-owned evidence reads shared with the interview and approval authorities. */
	private readonly reads: PrismaPersonaAggregateReadRepository;
	/** Draft-owned deterministic reviewed template selector. */
	private readonly templates: PersonaDraftTemplateSelectorRepository;

	/** Create the draft authority over one caller-owned transaction. */
	constructor(transaction: Prisma.TransactionClient)
	{
		this.transaction = transaction;
		this.reads = new PrismaPersonaAggregateReadRepository(this.transaction);
		this.templates = new PrismaPersonaDraftTemplateSelectorRepository(this.transaction);
	}

	/** Read exact owner evidence, derive bounded insights, and persist one reviewable revision. */
	async createFromInterviewAtomically(command: CreatePersonaDraftCommand): Promise<CreatePersonaDraftPersistenceResult>
	{
		return this._createDraft(command);
	}

	/** Execute the ordered draft invariants inside one serializable transaction snapshot. */
	private async _createDraft(command: CreatePersonaDraftCommand): Promise<CreatePersonaDraftPersistenceResult>
	{
		// 1. Rebind the exact owner profile so lineage comes from the serializable snapshot.
		const profile = await this.reads.readProfile(command);
		if (profile === null) return { status: PersonaDraftDenialReasons.NotFoundOrWrongOwner };

		// 2. Read the completed interview and all immutable answers from the same snapshot.
		const interview = await this._completedInterview(command);
		if (interview === null) return { status: PersonaDraftDenialReasons.InterviewIncomplete };

		// 3. Select the reviewed template and derive bounded insights from that exact evidence.
		const template = await this.templates.select(command.interviewId);
		if (template === null) return { status: PersonaDraftDenialReasons.TemplateNotSelected };
		const insights = await this._insightEvidence(interview);
		if (insights === null) return { status: PersonaDraftDenialReasons.InvalidInsights };

		// 4. Allocate from the snapshot and let Serializable plus the unique key reject races.
		return this._persistDraft(command, profile, template, insights);
	}

	/** Return the completed interview and its immutable answers from the transaction snapshot. */
	private async _completedInterview(command: CreatePersonaDraftCommand): Promise<PersonaDraftCompletedInterview | null>
	{
		const interview = await this.reads.readCompletedInterview(command);
		if (interview === null) return null;
		const answers = await this.transaction.personaInterviewAnswer.findMany({ where: { interviewId: command.interviewId }, select: { id: true, questionSetId: true, questionSetVersion: true, questionId: true, value: true }, orderBy: { id: "asc" } });
		return { questionSetId: interview.questionSetId, questionSetVersion: interview.questionSetVersion, answers };
	}

	/** Derive three to five insights and exact question provenance from the completed interview. */
	private async _insightEvidence(interview: PersonaDraftCompletedInterview): Promise<readonly PersonaDraftInsightEvidence<Prisma.PersonaInsightCreateManyInput["category"]>[] | null>
	{
		if (interview.answers.some(function _hasForeignQuestionSet(answer) { return answer.questionSetId !== interview.questionSetId || answer.questionSetVersion !== interview.questionSetVersion; })) return null;
		const answers = interview.answers.slice(0, 5);
		if (answers.length < 3) return null;
		const questions = await this.transaction.personaQuestion.findMany({ where: { questionSetId: interview.questionSetId, questionSetVersion: interview.questionSetVersion, id: { in: answers.map(function _questionId(answer) { return answer.questionId; }) } }, select: { id: true, category: true } });
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
	private async _persistDraft(command: CreatePersonaDraftCommand, profile: PersonaProfileRecord, template: PersonaDraftTemplateSelection, insights: readonly PersonaDraftInsightEvidence<Prisma.PersonaInsightCreateManyInput["category"]>[]): Promise<CreatePersonaDraftPersistenceResult>
	{
		const revisionNumber = await this.reads.readNextRevision(command.personaProfileId);
		const revision = await this.transaction.personaRevision.create({ data: _revisionData(command, profile.activeRevisionId, template, insights, revisionNumber), select: { id: true } });
		await this.transaction.personaInsight.createMany({ data: insights.map(function _toInsightData(insight) { return _insightData(revision.id, command.interviewId, insight); }) });
		return { status: PersonaLifecycleOutcomes.Created, personaRevisionId: revision.id };
	}
}

/** Build the Prisma revision input from validated serializable-snapshot evidence. */
function _revisionData(command: CreatePersonaDraftCommand, previousRevisionId: string | null, template: PersonaDraftTemplateSelection, insights: readonly PersonaDraftInsightEvidence<Prisma.PersonaInsightCreateManyInput["category"]>[], revision: number): Prisma.PersonaRevisionUncheckedCreateInput
{
	return { personaProfileId: command.personaProfileId, revision, soulTemplateId: template.templateId, soulTemplateVersion: template.templateVersion, soulTemplateDigest: template.templateDigest, interviewId: command.interviewId, selectionRuleId: template.selectionRuleId, selectionAnswerIds: [...template.selectionAnswerIds], compiledInstructions: _CompilePersonaDraftInstructions(template.content, insights), previousRevisionId, authoredBy: command.userId, createdAt: new Date(command.authoredAt) };
}

/** Build one Prisma insight input from server-derived answer provenance. */
function _insightData(personaRevisionId: string, interviewId: string, insight: PersonaDraftInsightEvidence<Prisma.PersonaInsightCreateManyInput["category"]>): Prisma.PersonaInsightCreateManyInput
{
	return { personaRevisionId, category: insight.category, statement: insight.statement, interviewId, questionSetId: insight.questionSetId, questionSetVersion: insight.questionSetVersion, questionId: insight.questionId, answerId: insight.answerId };
}
