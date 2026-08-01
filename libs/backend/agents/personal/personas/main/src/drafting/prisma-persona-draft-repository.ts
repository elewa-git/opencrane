import { Prisma } from "@prisma/client";

import type { Logger } from "@opencrane/observability";

import { _DoPersonaPersistenceWithTrace } from "../persona-persistence-observability.js";
import { PersonaLifecycleOutcomes } from "../profile/persona-lifecycle.types.js";
import type { PersonaProfileLock } from "../profile/persona-aggregate-lock-repository.types.js";
import { PrismaPersonaAggregateLockRepository } from "../profile/prisma-persona-aggregate-lock-repository.js";
import type { PersonaPersistenceUnitOfWork } from "../profile/persona-persistence-unit-of-work.types.js";

import { _CompilePersonaDraftInstructions } from "./persona-draft-instruction-compiler.js";
import { PersonaDraftDenialReasons, type CreatePersonaDraftCommand, type CreatePersonaDraftFromInterviewCommand, type CreatePersonaDraftPersistenceResult, type PersonaDraftFromInterviewRepository, type PersonaDraftRepository } from "./persona-draft-authority.types.js";
import type { PersonaDraftTemplateSelectorRepository } from "./persona-draft-template-selector.types.js";

/** Prisma authority that derives a draft persona only from one locked completed interview. */
export class PrismaPersonaDraftRepository implements PersonaDraftFromInterviewRepository, PersonaDraftRepository
{
	/** Persona-owned transaction boundary for draft-only operations. */
	private readonly transactions: PersonaPersistenceUnitOfWork;
	/** Aggregate-owned lock/read repository, the sole home for lifecycle raw locks. */
	private readonly locks: PrismaPersonaAggregateLockRepository;
	/** Draft-owned deterministic reviewed template selector. */
	private readonly templates: PersonaDraftTemplateSelectorRepository;
	/** App-owned structured logger for handled persistence failures. */
	private readonly logger: Logger;

	/** Create the draft authority over the canonical product database. */
	constructor(transactions: PersonaPersistenceUnitOfWork, locks: PrismaPersonaAggregateLockRepository, templates: PersonaDraftTemplateSelectorRepository, logger: Logger)
	{
		this.transactions = transactions;
		this.locks = locks;
		this.templates = templates;
		this.logger = logger;
	}

	/** Persist a caller-reviewed insight set in one serializable profile, interview, and revision transaction. */
	async createAtomically(command: CreatePersonaDraftCommand): Promise<CreatePersonaDraftPersistenceResult>
	{
		return this._create(command, command.insights, "persona.draft.create", "Persona draft persistence failed");
	}

	/** Derive bounded server-owned insight wording and persist it inside the same serializable transaction. */
	async createFromInterviewAtomically(command: CreatePersonaDraftFromInterviewCommand): Promise<CreatePersonaDraftPersistenceResult>
	{
		const transactions = this.transactions;
		const locks = this.locks;
		const templates = this.templates;
		const drafts = this;
		const logger = this.logger;
		try
		{
			return await _DoPersonaPersistenceWithTrace(logger, "persona.draft.derive", _DraftTraceAttributes(command), "Persona draft derivation persistence failed", async function _derive()
			{
				return transactions.run(async function _deriveWithinTransaction(client)
				{
					const transaction = client as Prisma.TransactionClient;
					// 1. Lock profile then completed interview so the derived evidence and revision allocation share one aggregate fence.
					const profile = await locks.lockProfile(transaction, command);
					if (profile === null) return { status: PersonaDraftDenialReasons.NotFoundOrWrongOwner } as const;
					const interview = await locks.lockCompletedInterview(transaction, command);
					if (interview === null) return { status: PersonaDraftDenialReasons.InterviewIncomplete } as const;

					// 2. Derive three-to-five answer-bound statements only after the completed interview is frozen by the aggregate lock.
					const answers = await transaction.personaInterviewAnswer.findMany({ where: { interviewId: command.interviewId }, select: { id: true, value: true }, orderBy: { id: "asc" }, take: 5 });
					if (answers.length < 3) return { status: PersonaDraftDenialReasons.InvalidInsights } as const;
					const insights = answers.map(function _toInsight(answer) { return { answerId: answer.id, statement: `Owner response: ${answer.value.trim()}` }; });

					// 3. Persist the derived evidence without opening a nested or follow-up transaction.
					return drafts._persistLockedDraft(transaction, locks, templates, command, profile, insights);
				});
			}, _IsDraftConflict);
		}
		catch (error)
		{
			if (_IsDraftConflict(error)) return { status: PersonaDraftDenialReasons.Conflict };
			return { status: PersonaDraftDenialReasons.PersistenceUnavailable };
		}
	}

	/** Run the caller-supplied insight path with the same locks and persistence order as server-derived drafts. */
	private async _create(command: CreatePersonaDraftCommand, insights: readonly { readonly answerId: string; readonly statement: string }[], operation: string, message: string): Promise<CreatePersonaDraftPersistenceResult>
	{
		const transactions = this.transactions;
		const locks = this.locks;
		const templates = this.templates;
		const drafts = this;
		const logger = this.logger;
		try
		{
			return await _DoPersonaPersistenceWithTrace(logger, operation, _DraftTraceAttributes(command), message, async function _traceCreate()
			{
				return transactions.run(async function _createWithinTransaction(client)
				{
					const transaction = client as Prisma.TransactionClient;
					// 1. Lock the owner profile then completed interview before selecting template or allocating its next revision.
					const profile = await locks.lockProfile(transaction, command);
					if (profile === null) return { status: PersonaDraftDenialReasons.NotFoundOrWrongOwner } as const;
					const interview = await locks.lockCompletedInterview(transaction, command);
					if (interview === null) return { status: PersonaDraftDenialReasons.InterviewIncomplete } as const;

					// 2. Keep template selection and answer provenance inside the same exact locked evidence view.
					return drafts._persistLockedDraft(transaction, locks, templates, command, profile, insights);
				});
			});
		}
		catch (error)
		{
			if (_IsDraftConflict(error)) return { status: PersonaDraftDenialReasons.Conflict };
			return { status: PersonaDraftDenialReasons.PersistenceUnavailable };
		}
	}
/** Persist one already locked draft and its answer provenance in deterministic authority order. */
	private async _persistLockedDraft(client: Prisma.TransactionClient, locks: PrismaPersonaAggregateLockRepository, templates: PersonaDraftTemplateSelectorRepository, command: CreatePersonaDraftCommand | CreatePersonaDraftFromInterviewCommand, profile: PersonaProfileLock, insights: readonly { readonly answerId: string; readonly statement: string }[]): Promise<CreatePersonaDraftPersistenceResult>
	{
	// 1. Derive the reviewed source and validate every exact answer reference before any new revision exists.
	const template = await templates.select(client, command.interviewId);
	if (template === null) return { status: PersonaDraftDenialReasons.TemplateNotSelected } as const;
	const evidence = await this._insightEvidence(client, command.interviewId, insights);
	if (evidence === null) return { status: PersonaDraftDenialReasons.InvalidInsights } as const;

	// 2. Allocate under the held profile lock, then write the immutable revision before dependent insight rows.
	const revisionNumber = await locks.readNextRevision(client, command.personaProfileId);
	const revision = await client.personaRevision.create({ data: { personaProfileId: command.personaProfileId, revision: revisionNumber, soulTemplateId: template.templateId, soulTemplateVersion: template.templateVersion, soulTemplateDigest: template.templateDigest, interviewId: command.interviewId, selectionRuleId: template.selectionRuleId, selectionAnswerIds: [...template.selectionAnswerIds], compiledInstructions: _CompilePersonaDraftInstructions(template.content, insights), previousRevisionId: profile.activeRevisionId, authoredBy: command.userId, createdAt: new Date(command.authoredAt) }, select: { id: true } });

	// 3. Store only source-bound insight evidence, leaving the baseline trigger as the independent commit-time guard.
		await client.personaInsight.createMany({ data: evidence.map(function _toInsight(item) { return { personaRevisionId: revision.id, category: item.category, statement: item.statement, interviewId: command.interviewId, questionSetId: item.questionSetId, questionSetVersion: item.questionSetVersion, questionId: item.questionId, answerId: item.answerId }; }) });
		return { status: PersonaLifecycleOutcomes.Created, personaRevisionId: revision.id } as const;
	}

	/** Read exact persisted question provenance for supplied insights without raw query construction. */
	private async _insightEvidence(client: Prisma.TransactionClient, interviewId: string, insights: readonly { readonly answerId: string; readonly statement: string }[]): Promise<readonly { readonly answerId: string; readonly statement: string; readonly category: "RelationshipRole" | "ToneLanguage" | "AnswerStructure" | "ChallengeSupport" | "Initiative" | "ApprovalRisk" | "WorkingHabits" | "MemoryBoundaries"; readonly questionSetId: string; readonly questionSetVersion: number; readonly questionId: string }[] | null>
	{
	const answerIds = insights.map(function _answerId(insight) { return insight.answerId; });
	if (new Set(answerIds).size !== answerIds.length) return null;
	const answers = await client.personaInterviewAnswer.findMany({ where: { interviewId, id: { in: answerIds } }, select: { id: true, questionSetId: true, questionSetVersion: true, questionId: true } });
	if (answers.length !== insights.length) return null;
	const questions = await client.personaQuestion.findMany({ where: { OR: answers.map(function _questionCoordinate(answer) { return { id: answer.questionId, questionSetId: answer.questionSetId, questionSetVersion: answer.questionSetVersion }; }) }, select: { id: true, questionSetId: true, questionSetVersion: true, category: true } });
	const categories = new Map(questions.map(function _toCategory(question) { return [`${question.questionSetId}:${question.questionSetVersion}:${question.id}`, question.category]; }));
	const evidenceById = new Map(answers.map(function _toEvidence(answer) { return [answer.id, { ...answer, category: categories.get(`${answer.questionSetId}:${answer.questionSetVersion}:${answer.questionId}`) }]; }));
	return insights.map(function _toExactEvidence(insight)
	{
		const answer = evidenceById.get(insight.answerId);
		return answer === undefined || answer.category === undefined ? null : { answerId: answer.id, statement: insight.statement, category: answer.category, questionSetId: answer.questionSetId, questionSetVersion: answer.questionSetVersion, questionId: answer.questionId };
	}).every(function _isPresent(item) { return item !== null; }) ? insights.map(function _toResult(insight)
	{
		const answer = evidenceById.get(insight.answerId)!;
		return { answerId: answer.id, statement: insight.statement, category: answer.category!, questionSetId: answer.questionSetId, questionSetVersion: answer.questionSetVersion, questionId: answer.questionId };
	}) : null;
}
}

/** Produce trace attributes shared by caller-supplied and server-derived draft paths. */
function _DraftTraceAttributes(command: CreatePersonaDraftCommand | CreatePersonaDraftFromInterviewCommand): { readonly siloId: string; readonly userId: string; readonly personaProfileId: string; readonly interviewId: string }
{
	return { siloId: command.siloId, userId: command.userId, personaProfileId: command.personaProfileId, interviewId: command.interviewId };
}

/** Recognise only concurrent unique-key and serializable transaction-write races as draft conflicts. */
function _IsDraftConflict(error: unknown): boolean
{
	return error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2002" || error.code === "P2034");
}
