import { PersonaInterviewState, PersonaQuestionSetState, Prisma } from "@prisma/client";

import { PersonalConfigurationPersonaRefreshClaimCodes, PrismaPersonalConfigurationPersonaRefreshRepository } from "@opencrane/backend/agents/personal/configuration";

import { PersonaAggregateInterviewStates } from "../profile/persona-aggregate-read-repository.types.js";
import { PersonaInterviewDenialReasons, PersonaLifecycleOutcomes } from "../profile/persona-lifecycle.types.js";
import { PrismaPersonaAggregateReadRepository } from "../profile/prisma-persona-aggregate-read-repository.js";
import type { CompletePersonaInterviewCommand, PersonaInterviewQuestionReader, PersonaInterviewRepository, RecordPersonaInterviewAnswerCommand, StartPersonaInterviewCommand } from "./persona-interview-authority.types.js";

/** Prisma authority for the append-only, reviewed-question-set persona interview lifecycle. */
export class PrismaPersonaInterviewRepository implements PersonaInterviewRepository, PersonaInterviewQuestionReader
{
	/** Transaction-scoped canonical product database. */
	private readonly transaction: Prisma.TransactionClient;
	/** Configuration-owned proposal repository bound to the same transaction. */
	private readonly refreshes: PrismaPersonalConfigurationPersonaRefreshRepository;
	/** Aggregate-owned evidence reads shared with draft and approval mutation fences. */
	private readonly reads: PrismaPersonaAggregateReadRepository;
	/** Create the interview authority over one caller-owned transaction. */
	constructor(transaction: Prisma.TransactionClient)
	{
		this.transaction = transaction;
		this.refreshes = new PrismaPersonalConfigurationPersonaRefreshRepository(this.transaction);
		this.reads = new PrismaPersonaAggregateReadRepository(this.transaction);
	}

	/** Read only the exact question-set revision frozen into one owner interview. */
	async getQuestions(interviewId: string, personaProfileId: string, userId: string): Promise<readonly { readonly id: string; readonly category: string; readonly prompt: string; readonly ordinal: number }[] | null>
	{
		const interview = await this.transaction.personaInterview.findFirst({ where: { id: interviewId, personaProfileId, userId }, select: { questionSetId: true, questionSetVersion: true } });
		if (interview === null) return null;
		return this.transaction.personaQuestion.findMany({ where: { questionSetId: interview.questionSetId, questionSetVersion: interview.questionSetVersion }, select: { id: true, category: true, prompt: true, ordinal: true }, orderBy: { ordinal: "asc" } });
	}

	/** Start one reviewed interview while serialising all in-progress attempts for the same profile. */
	async startAtomically(command: StartPersonaInterviewCommand): Promise<{ readonly status: PersonaLifecycleOutcomes.Started | PersonaLifecycleOutcomes.AlreadyInProgress; readonly interviewId: string } | { readonly status: PersonaInterviewDenialReasons }>
	{
		// 1. Read the owner profile; two racing browser starts abort at the unit-of-work boundary.
		const profile = await this.reads.readProfile(command);
		if (profile === null) return { status: PersonaInterviewDenialReasons.NotFoundOrWrongOwner };
		// 2. Claim only an accepted owner-bound persona-refresh proposal before any interview exists.
		if (command.refreshConfigurationChangeId !== null)
		{
			const refresh = await this.refreshes.claimAcceptedPersonaRefresh({ configurationChangeId: command.refreshConfigurationChangeId, siloId: command.siloId, userId: command.userId, personaProfileId: command.personaProfileId });
			if (refresh !== PersonalConfigurationPersonaRefreshClaimCodes.Accepted) return { status: PersonaInterviewDenialReasons.RefreshChangeUnavailable };
		}
		// 3. Reuse a still-active interview; a different refresh may not hijack unreviewed answers.
		const existing = await this.transaction.personaInterview.findFirst({ where: { personaProfileId: command.personaProfileId, userId: command.userId, state: PersonaInterviewState.InProgress }, select: { id: true, refreshConfigurationChangeId: true } });
		if (existing !== null)
		{
			return command.refreshConfigurationChangeId === null || existing.refreshConfigurationChangeId === command.refreshConfigurationChangeId
				? { status: PersonaLifecycleOutcomes.AlreadyInProgress, interviewId: existing.id }
				: { status: PersonaInterviewDenialReasons.RefreshInterviewConflict };
		}
		// 4. Accept only an exact reviewed question-set revision before recording the interview attempt.
		const questionSet = await this.transaction.personaQuestionSet.findUnique({ where: { id_version: { id: command.questionSetId, version: command.questionSetVersion } }, select: { state: true } });
		if (questionSet?.state !== PersonaQuestionSetState.Reviewed) return { status: PersonaInterviewDenialReasons.QuestionSetUnavailable };
		const interview = await this.transaction.personaInterview.create({ data: { personaProfileId: command.personaProfileId, userId: command.userId, refreshConfigurationChangeId: command.refreshConfigurationChangeId, questionSetId: command.questionSetId, questionSetVersion: command.questionSetVersion, startedAt: new Date(command.startedAt) }, select: { id: true } });
		return { status: PersonaLifecycleOutcomes.Started, interviewId: interview.id };
	}

	/** Append one answer only after locking the exact owner interview and question-set revision. */
	async recordAnswerAtomically(command: RecordPersonaInterviewAnswerCommand): Promise<{ readonly status: PersonaLifecycleOutcomes.Recorded; readonly answerId: string } | { readonly status: PersonaInterviewDenialReasons }>
	{
		// 1. Read the interview, proving its owner; a completion racing this append aborts as a serializable conflict.
		const interview = await this.reads.readInterview(command);
		if (interview === null) return { status: PersonaInterviewDenialReasons.NotFoundOrWrongOwner };
		if (interview.state !== PersonaAggregateInterviewStates.InProgress) return { status: PersonaInterviewDenialReasons.NotInProgress };
		// 2. Check the question belongs to the exact reviewed set that was frozen when this interview began.
		const question = await this.transaction.personaQuestion.findUnique({ where: { questionSetId_questionSetVersion_id: { questionSetId: interview.questionSetId, questionSetVersion: interview.questionSetVersion, id: command.questionId } }, select: { id: true } });
		if (question === null) return { status: PersonaInterviewDenialReasons.QuestionUnavailable };
		const existing = await this.transaction.personaInterviewAnswer.findUnique({ where: { interviewId_questionId: { interviewId: command.interviewId, questionId: command.questionId } }, select: { id: true } });
		if (existing !== null) return { status: PersonaInterviewDenialReasons.AlreadyAnswered };
		// 3. Persist the immutable answer with the question-set provenance the baseline trigger independently verifies.
		const answer = await this.transaction.personaInterviewAnswer.create({ data: { interviewId: command.interviewId, questionSetId: interview.questionSetId, questionSetVersion: interview.questionSetVersion, questionId: command.questionId, value: command.value.trim(), answeredAt: new Date(command.answeredAt) }, select: { id: true } });
		return { status: PersonaLifecycleOutcomes.Recorded, answerId: answer.id };
	}

	/** Freeze one interview only once its exact reviewed-question set has every answer. */
	async completeAtomically(command: CompletePersonaInterviewCommand): Promise<{ readonly status: PersonaLifecycleOutcomes.Completed } | { readonly status: PersonaInterviewDenialReasons }>
	{
		// 1. Read the interview before counting evidence; an answer racing this completion aborts as a conflict.
		const interview = await this.reads.readInterview(command);
		if (interview === null) return { status: PersonaInterviewDenialReasons.NotFoundOrWrongOwner };
		if (interview.state !== PersonaAggregateInterviewStates.InProgress) return { status: PersonaInterviewDenialReasons.NotInProgress };
		// 2. Compare the exact reviewed question count with the immutable answers before completion.
		const expectedAnswers = await this.transaction.personaQuestion.count({ where: { questionSetId: interview.questionSetId, questionSetVersion: interview.questionSetVersion } });
		const actualAnswers = await this.transaction.personaInterviewAnswer.count({ where: { interviewId: command.interviewId } });
		if (expectedAnswers === 0 || actualAnswers !== expectedAnswers) return { status: PersonaInterviewDenialReasons.IncompleteAnswers };
		// 3. Change only the closed lifecycle state; the target-baseline trigger repeats the answer fence at commit.
		const updated = await this.transaction.personaInterview.updateMany({ where: { id: command.interviewId, personaProfileId: command.personaProfileId, userId: command.userId, state: PersonaInterviewState.InProgress }, data: { state: PersonaInterviewState.Completed, completedAt: new Date(command.completedAt) } });
		return updated.count === 1 ? { status: PersonaLifecycleOutcomes.Completed } : { status: PersonaInterviewDenialReasons.NotInProgress };
	}
}
