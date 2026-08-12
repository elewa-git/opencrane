import { PersonaInterviewState, PersonaQuestionSetState, Prisma } from "@prisma/client";

import { PersonalConfigurationPersonaRefreshClaimCodes, PrismaPersonalConfigurationPersonaRefreshRepository } from "@opencrane/backend/agents/personal/configuration";

import { PersonaAggregateInterviewStates } from "../profile/persona-aggregate-read-repository.types.js";
import { PersonaInterviewDenialReasons, PersonaLifecycleOutcomes } from "../profile/persona-lifecycle.types.js";
import { PrismaPersonaAggregateReadRepository } from "../profile/prisma-persona-aggregate-read-repository.js";
import { PersonaScoringPersistenceStatuses } from "../scoring/persona-scoring-repository.types.js";
import { PrismaPersonaScoringRepository } from "../scoring/prisma-persona-scoring-repository.js";
import type { CompletePersonaInterviewCommand, PersonaInterviewQuestionReader, PersonaInterviewRepository, RecordPersonaInterviewAnswerCommand, ResolvePersonaInterviewTieCommand, StartPersonaInterviewCommand } from "./persona-interview-authority.types.js";

/** Prisma adapter for the persona interview lifecycle. Answers are only added, never changed. */
export class PrismaPersonaInterviewRepository implements PersonaInterviewRepository, PersonaInterviewQuestionReader
{
	/** Prisma client for the caller's transaction; every read and write here uses it. */
	private readonly transaction: Prisma.TransactionClient;
	/** Persona-refresh proposal repository, on the same transaction. */
	private readonly refreshes: PrismaPersonalConfigurationPersonaRefreshRepository;
	/** Shared reader for profile, interview, and revision rows; the draft and approval paths use the same one. */
	private readonly reads: PrismaPersonaAggregateReadRepository;
	/** Score repository, on the same transaction. */
	private readonly scoring: PrismaPersonaScoringRepository;
	/** Create the interview authority over one caller-owned transaction. */
	constructor(transaction: Prisma.TransactionClient)
	{
		this.transaction = transaction;
		this.refreshes = new PrismaPersonalConfigurationPersonaRefreshRepository(this.transaction);
		this.reads = new PrismaPersonaAggregateReadRepository(this.transaction);
		this.scoring = new PrismaPersonaScoringRepository(this.transaction);
	}

	/** Reads the questions from the question-set version this interview was pinned to. */
	async getQuestions(interviewId: string, personaProfileId: string, userId: string): ReturnType<PersonaInterviewQuestionReader["getQuestions"]>
	{
		const interview = await this.transaction.personaInterview.findFirst({ where: { id: interviewId, personaProfileId, userId }, select: { questionSetId: true, questionSetVersion: true } });
		if (interview === null) return null;
		return this.transaction.personaQuestion.findMany({ where: { questionSetId: interview.questionSetId, questionSetVersion: interview.questionSetVersion }, select: { id: true, category: true, prompt: true, ordinal: true, choices: { select: { id: true, label: true, ordinal: true }, orderBy: { ordinal: "asc" } } }, orderBy: { ordinal: "asc" } });
	}

	/** Starts one interview. Serializable isolation makes two simultaneous starts for the same profile collide instead of both succeeding. */
	async startAtomically(command: StartPersonaInterviewCommand): Promise<{ readonly status: PersonaLifecycleOutcomes.Started | PersonaLifecycleOutcomes.AlreadyInProgress; readonly interviewId: string } | { readonly status: PersonaInterviewDenialReasons }>
	{
		// 1. Read the owner's profile. If two browser tabs start at once, one aborts in the transaction wrapper.
		const profile = await this.reads.readProfile(command);
		if (profile === null) return { status: PersonaInterviewDenialReasons.NotFoundOrWrongOwner };
		// 2. Claim the refresh proposal first, and only when it is accepted and belongs to this owner and profile.
		if (command.refreshConfigurationChangeId !== null)
		{
			const refresh = await this.refreshes.claimAcceptedPersonaRefresh({ configurationChangeId: command.refreshConfigurationChangeId, siloId: command.siloId, userId: command.userId, personaProfileId: command.personaProfileId });
			if (refresh !== PersonalConfigurationPersonaRefreshClaimCodes.Accepted) return { status: PersonaInterviewDenialReasons.RefreshChangeUnavailable };
		}
		// 3. Reuse an interview that is still in progress. A different refresh request must not take over answers the owner has not reviewed yet.
		const existing = await this.transaction.personaInterview.findFirst({ where: { personaProfileId: command.personaProfileId, userId: command.userId, state: PersonaInterviewState.InProgress }, select: { id: true, refreshConfigurationChangeId: true } });
		if (existing !== null)
		{
			return command.refreshConfigurationChangeId === null || existing.refreshConfigurationChangeId === command.refreshConfigurationChangeId
				? { status: PersonaLifecycleOutcomes.AlreadyInProgress, interviewId: existing.id }
				: { status: PersonaInterviewDenialReasons.RefreshInterviewConflict };
		}
		// 4. Require the question set to exist at this exact version and still be Reviewed, and require both derivation sources to exist.
		const [questionSet, scoringPolicy, interpolationMap] = await Promise.all([
			this.transaction.personaQuestionSet.findUnique({ where: { id_version: { id: command.questionSetId, version: command.questionSetVersion } }, select: { state: true } }),
			this.transaction.personaScoringPolicy.findUnique({ where: { id_version: { id: command.scoringPolicyId, version: command.scoringPolicyVersion } }, select: { id: true } }),
			this.transaction.personaInterpolationMap.findUnique({ where: { id_version: { id: command.interpolationMapId, version: command.interpolationMapVersion } }, select: { id: true } }),
		]);
		if (questionSet?.state !== PersonaQuestionSetState.Reviewed || scoringPolicy === null || interpolationMap === null) return { status: PersonaInterviewDenialReasons.QuestionSetUnavailable };
		const interview = await this.transaction.personaInterview.create({ data: { personaProfileId: command.personaProfileId, userId: command.userId, refreshConfigurationChangeId: command.refreshConfigurationChangeId, questionSetId: command.questionSetId, questionSetVersion: command.questionSetVersion, scoringPolicyId: command.scoringPolicyId, scoringPolicyVersion: command.scoringPolicyVersion, interpolationMapId: command.interpolationMapId, interpolationMapVersion: command.interpolationMapVersion, startedAt: new Date(command.startedAt) }, select: { id: true } });
		return { status: PersonaLifecycleOutcomes.Started, interviewId: interview.id };
	}

	/** Adds one answer, after re-reading the owner's interview and checking the choice belongs to its pinned question set. */
	async recordAnswerAtomically(command: RecordPersonaInterviewAnswerCommand): Promise<{ readonly status: PersonaLifecycleOutcomes.Recorded; readonly answerId: string } | { readonly status: PersonaInterviewDenialReasons }>
	{
		// 1. Read the interview, which also proves the owner. A completion running at the same time aborts as a serialization conflict.
		const interview = await this.reads.readInterview(command);
		if (interview === null) return { status: PersonaInterviewDenialReasons.NotFoundOrWrongOwner };
		if (interview.state !== PersonaAggregateInterviewStates.InProgress) return { status: PersonaInterviewDenialReasons.NotInProgress };
		// 2. Check the question belongs to the exact reviewed set that was frozen when this interview began.
		const choice = await this.transaction.personaQuestionChoice.findUnique({ where: { questionSetId_questionSetVersion_questionId_id: { questionSetId: interview.questionSetId, questionSetVersion: interview.questionSetVersion, questionId: command.questionId, id: command.choiceId } }, select: { id: true } });
		if (choice === null) return { status: PersonaInterviewDenialReasons.QuestionUnavailable };
		const existing = await this.transaction.personaInterviewAnswer.findUnique({ where: { interviewId_questionId: { interviewId: command.interviewId, questionId: command.questionId } }, select: { id: true } });
		if (existing !== null) return { status: PersonaInterviewDenialReasons.AlreadyAnswered };
		// 3. Write the answer with its question-set id and version. The persona_interview_answers_exact_question_set trigger checks them again.
		const answer = await this.transaction.personaInterviewAnswer.create({ data: { interviewId: command.interviewId, questionSetId: interview.questionSetId, questionSetVersion: interview.questionSetVersion, questionId: command.questionId, choiceId: command.choiceId, answeredAt: new Date(command.answeredAt) }, select: { id: true } });
		return { status: PersonaLifecycleOutcomes.Recorded, answerId: answer.id };
	}

	/** Completes one interview, but only when every question in its pinned question set has an answer. */
	async completeAtomically(command: CompletePersonaInterviewCommand): ReturnType<PersonaInterviewRepository["completeAtomically"]>
	{
		// 1. Read the interview before counting. An answer written at the same time aborts as a conflict.
		const interview = await this.reads.readInterview(command);
		if (interview === null) return { status: PersonaInterviewDenialReasons.NotFoundOrWrongOwner };
		if (interview.state !== PersonaAggregateInterviewStates.InProgress) return { status: PersonaInterviewDenialReasons.NotInProgress };
		// 2. Compare the number of questions with the number of answers.
		const expectedAnswers = await this.transaction.personaQuestion.count({ where: { questionSetId: interview.questionSetId, questionSetVersion: interview.questionSetVersion } });
		const actualAnswers = await this.transaction.personaInterviewAnswer.count({ where: { interviewId: command.interviewId } });
		if (expectedAnswers === 0 || actualAnswers !== expectedAnswers) return { status: PersonaInterviewDenialReasons.IncompleteAnswers };
		// 3. Change only the state. The persona_interviews_closed_lifecycle trigger counts the answers again on this update.
		const updated = await this.transaction.personaInterview.updateMany({ where: { id: command.interviewId, personaProfileId: command.personaProfileId, userId: command.userId, state: PersonaInterviewState.InProgress }, data: { state: PersonaInterviewState.Completed, completedAt: new Date(command.completedAt) } });
		if (updated.count !== 1) return { status: PersonaInterviewDenialReasons.NotInProgress };
		const scoring = await this.scoring.ensureScore(command.interviewId, command.personaProfileId, command.userId);
		if (scoring.status !== PersonaScoringPersistenceStatuses.Ready) throw new Error("completed persona interview could not be scored");
		return { status: PersonaLifecycleOutcomes.Completed, score: scoring.score };
	}

	/** Records the owner's tie choice, refusing a choice for a tie the score is not waiting on. */
	async resolveTieAtomically(command: ResolvePersonaInterviewTieCommand): ReturnType<PersonaInterviewRepository["resolveTieAtomically"]>
	{
		const result = await this.scoring.resolveTie(command);
		if (result.status === PersonaScoringPersistenceStatuses.Ready) return { status: PersonaLifecycleOutcomes.Recorded, score: result.score };
		if (result.status === PersonaScoringPersistenceStatuses.AlreadyResolved) return { status: PersonaInterviewDenialReasons.AlreadyResolved };
		if (result.status === PersonaScoringPersistenceStatuses.InvalidResolution) return { status: PersonaInterviewDenialReasons.InvalidResolution };
		return { status: PersonaInterviewDenialReasons.NotFoundOrWrongOwner };
	}
}
