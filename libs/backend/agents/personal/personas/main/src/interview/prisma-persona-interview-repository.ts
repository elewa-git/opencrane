import { PersonaInterviewState, PersonaQuestionSetState, Prisma, type PrismaClient } from "@prisma/client";

import { PersonalConfigurationPersonaRefreshClaimCodes, type PersonalConfigurationPersonaRefreshUnitOfWork } from "@opencrane/backend/agents/personal/configuration";
import type { Logger } from "@opencrane/observability";

import { _DoPersonaPersistenceWithTrace } from "../persona-persistence-observability.js";
import { PersonaInterviewDenialReasons, PersonaLifecycleOutcomes } from "../profile/persona-lifecycle.types.js";
import type { PersonaPersistenceUnitOfWork } from "../profile/persona-persistence-unit-of-work.types.js";
import type { CompletePersonaInterviewCommand, PersonaInterviewQuestionReader, PersonaInterviewRepository, RecordPersonaInterviewAnswerCommand, StartPersonaInterviewCommand } from "./persona-interview-authority.types.js";

/** Prisma authority for the append-only, reviewed-question-set persona interview lifecycle. */
export class PrismaPersonaInterviewRepository implements PersonaInterviewRepository, PersonaInterviewQuestionReader
{
	/** Canonical per-silo product database. */
	private readonly prisma: PrismaClient;
	/** Configuration-owned transaction boundary for proposal-bound interview starts. */
	private readonly refreshes: PersonalConfigurationPersonaRefreshUnitOfWork;
	/** Persona-owned transaction boundary for answer and completion operations. */
	private readonly transactions: PersonaPersistenceUnitOfWork;
	/** App-owned structured logger for handled persistence failures. */
	private readonly logger: Logger;

	/** Create the interview authority over the canonical product database. */
	constructor(prisma: PrismaClient, refreshes: PersonalConfigurationPersonaRefreshUnitOfWork, transactions: PersonaPersistenceUnitOfWork, logger: Logger)
	{
		this.prisma = prisma;
		this.refreshes = refreshes;
		this.transactions = transactions;
		this.logger = logger;
	}
	/** Read only the exact question-set revision frozen into one owner interview. */
	async getQuestions(interviewId: string, personaProfileId: string, userId: string): Promise<readonly { readonly id: string; readonly category: string; readonly prompt: string; readonly ordinal: number }[] | null>
	{
		const interview = await this.prisma.personaInterview.findFirst({ where: { id: interviewId, personaProfileId, userId }, select: { questionSetId: true, questionSetVersion: true } });
		if (interview === null) return null;
		return this.prisma.personaQuestion.findMany({ where: { questionSetId: interview.questionSetId, questionSetVersion: interview.questionSetVersion }, select: { id: true, category: true, prompt: true, ordinal: true }, orderBy: { ordinal: "asc" } });
	}
	/** Start one reviewed interview while serialising all in-progress attempts for the same profile. */
	async startAtomically(command: StartPersonaInterviewCommand): Promise<{ readonly status: PersonaLifecycleOutcomes.Started | PersonaLifecycleOutcomes.AlreadyInProgress; readonly interviewId: string } | { readonly status: PersonaInterviewDenialReasons }>
	{
		const refreshes = this.refreshes;
		try
		{
			return await _DoPersonaPersistenceWithTrace(this.logger, "persona.interview.start", { siloId: command.siloId, userId: command.userId, personaProfileId: command.personaProfileId }, "Persona interview start persistence failed", async function _traceStart()
			{
				return refreshes.runPersonaRefresh(async function _start(transaction, refreshClaims)
				{
					const client = transaction as Prisma.TransactionClient;
					// 1. Lock the owner profile so two browser requests cannot create competing active interviews.
					const profiles = await client.$queryRaw<readonly { readonly id: string }[]>(Prisma.sql`SELECT "id" FROM "persona_profiles" WHERE "id" = ${command.personaProfileId} AND "silo_id" = ${command.siloId} AND "user_id" = ${command.userId} FOR UPDATE`);
					if (profiles.length !== 1) return { status: PersonaInterviewDenialReasons.NotFoundOrWrongOwner } as const;
					// 2. Claim only an accepted owner-bound persona-refresh proposal before any interview exists.
					if (command.refreshConfigurationChangeId !== null)
					{
						const refresh = await refreshClaims.claimAcceptedPersonaRefresh({ configurationChangeId: command.refreshConfigurationChangeId, siloId: command.siloId, userId: command.userId, personaProfileId: command.personaProfileId });
						if (refresh !== PersonalConfigurationPersonaRefreshClaimCodes.Accepted) return { status: PersonaInterviewDenialReasons.RefreshChangeUnavailable } as const;
					}
					// 3. Reuse a still-active interview; a different refresh may not hijack unreviewed answers.
					const existing = await client.personaInterview.findFirst({ where: { personaProfileId: command.personaProfileId, userId: command.userId, state: PersonaInterviewState.InProgress }, select: { id: true, refreshConfigurationChangeId: true } });
					if (existing !== null)
					{
						return command.refreshConfigurationChangeId === null || existing.refreshConfigurationChangeId === command.refreshConfigurationChangeId
							? { status: PersonaLifecycleOutcomes.AlreadyInProgress, interviewId: existing.id } as const
							: { status: PersonaInterviewDenialReasons.RefreshInterviewConflict } as const;
					}

					// 4. Accept only an exact reviewed question-set revision before recording the interview attempt.
					const questionSet = await client.personaQuestionSet.findUnique({ where: { id_version: { id: command.questionSetId, version: command.questionSetVersion } }, select: { state: true } });
					if (questionSet?.state !== PersonaQuestionSetState.Reviewed) return { status: PersonaInterviewDenialReasons.QuestionSetUnavailable } as const;
					const interview = await client.personaInterview.create({ data: { personaProfileId: command.personaProfileId, userId: command.userId, refreshConfigurationChangeId: command.refreshConfigurationChangeId, questionSetId: command.questionSetId, questionSetVersion: command.questionSetVersion, startedAt: new Date(command.startedAt) }, select: { id: true } });
					return { status: PersonaLifecycleOutcomes.Started, interviewId: interview.id } as const;
				});
			});
		}
		catch
		{
			return { status: PersonaInterviewDenialReasons.PersistenceUnavailable };
		}
	}
	/** Append one answer only after locking the exact owner interview and question-set revision. */
	async recordAnswerAtomically(command: RecordPersonaInterviewAnswerCommand): Promise<{ readonly status: PersonaLifecycleOutcomes.Recorded; readonly answerId: string } | { readonly status: PersonaInterviewDenialReasons }>
	{
		const transactions = this.transactions;
		try
		{
			return await _DoPersonaPersistenceWithTrace(this.logger, "persona.interview.answer", { userId: command.userId, personaProfileId: command.personaProfileId, interviewId: command.interviewId }, "Persona interview answer persistence failed", async function _traceAnswer()
			{
				return transactions.run(async function _record(transaction)
				{
					const client = transaction as Prisma.TransactionClient;
				// 1. Lock the interview, proving its owner and keeping completion from racing an answer append.
				const interviews = await client.$queryRaw<readonly { readonly questionSetId: string; readonly questionSetVersion: number; readonly state: "in_progress" | "completed" }[]>(Prisma.sql`SELECT "question_set_id" AS "questionSetId", "question_set_version" AS "questionSetVersion", "state" FROM "persona_interviews" WHERE "id" = ${command.interviewId} AND "persona_profile_id" = ${command.personaProfileId} AND "user_id" = ${command.userId} FOR UPDATE`);
				if (interviews.length !== 1) return { status: PersonaInterviewDenialReasons.NotFoundOrWrongOwner } as const;
				const interview = interviews[0];
				if (interview.state !== "in_progress") return { status: PersonaInterviewDenialReasons.NotInProgress } as const;

				// 2. Check the question belongs to the exact reviewed set that was frozen when this interview began.
				const question = await client.personaQuestion.findUnique({ where: { questionSetId_questionSetVersion_id: { questionSetId: interview.questionSetId, questionSetVersion: interview.questionSetVersion, id: command.questionId } }, select: { id: true } });
				if (question === null) return { status: PersonaInterviewDenialReasons.QuestionUnavailable } as const;
				const existing = await client.personaInterviewAnswer.findUnique({ where: { interviewId_questionId: { interviewId: command.interviewId, questionId: command.questionId } }, select: { id: true } });
				if (existing !== null) return { status: PersonaInterviewDenialReasons.AlreadyAnswered } as const;

				// 3. Persist the immutable answer with the question-set provenance the baseline trigger independently verifies.
				const answer = await client.personaInterviewAnswer.create({ data: { interviewId: command.interviewId, questionSetId: interview.questionSetId, questionSetVersion: interview.questionSetVersion, questionId: command.questionId, value: command.value.trim(), answeredAt: new Date(command.answeredAt) }, select: { id: true } });
					return { status: PersonaLifecycleOutcomes.Recorded, answerId: answer.id } as const;
				});
			}, function _duplicateAnswer(error) { return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"; });
		}
		catch (error)
		{
			if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return { status: PersonaInterviewDenialReasons.AlreadyAnswered };
			return { status: PersonaInterviewDenialReasons.PersistenceUnavailable };
		}
	}
	/** Freeze one interview only once its exact reviewed-question set has every answer. */
	async completeAtomically(command: CompletePersonaInterviewCommand): Promise<{ readonly status: PersonaLifecycleOutcomes.Completed } | { readonly status: PersonaInterviewDenialReasons }>
	{
		const transactions = this.transactions;
		try
		{
			return await _DoPersonaPersistenceWithTrace(this.logger, "persona.interview.complete", { userId: command.userId, personaProfileId: command.personaProfileId, interviewId: command.interviewId }, "Persona interview completion persistence failed", async function _traceComplete()
			{
				return transactions.run(async function _complete(transaction)
				{
					const client = transaction as Prisma.TransactionClient;
				// 1. Lock the interview before counting evidence, sharing the same fence as answer append.
				const interviews = await client.$queryRaw<readonly { readonly questionSetId: string; readonly questionSetVersion: number; readonly state: "in_progress" | "completed" }[]>(Prisma.sql`SELECT "question_set_id" AS "questionSetId", "question_set_version" AS "questionSetVersion", "state" FROM "persona_interviews" WHERE "id" = ${command.interviewId} AND "persona_profile_id" = ${command.personaProfileId} AND "user_id" = ${command.userId} FOR UPDATE`);
				if (interviews.length !== 1) return { status: PersonaInterviewDenialReasons.NotFoundOrWrongOwner } as const;
				const interview = interviews[0];
				if (interview.state !== "in_progress") return { status: PersonaInterviewDenialReasons.NotInProgress } as const;

				// 2. Compare the exact reviewed question count with the immutable answers before completion.
				const expectedAnswers = await client.personaQuestion.count({ where: { questionSetId: interview.questionSetId, questionSetVersion: interview.questionSetVersion } });
				const actualAnswers = await client.personaInterviewAnswer.count({ where: { interviewId: command.interviewId } });
				if (expectedAnswers === 0 || actualAnswers !== expectedAnswers) return { status: PersonaInterviewDenialReasons.IncompleteAnswers } as const;

				// 3. Change only the closed lifecycle state; the target-baseline trigger repeats the answer fence at commit.
				const updated = await client.personaInterview.updateMany({ where: { id: command.interviewId, personaProfileId: command.personaProfileId, userId: command.userId, state: PersonaInterviewState.InProgress }, data: { state: PersonaInterviewState.Completed, completedAt: new Date(command.completedAt) } });
					return updated.count === 1 ? { status: PersonaLifecycleOutcomes.Completed } as const : { status: PersonaInterviewDenialReasons.NotInProgress } as const;
				});
			});
		}
		catch
		{
			return { status: PersonaInterviewDenialReasons.PersistenceUnavailable };
		}
	}
}
