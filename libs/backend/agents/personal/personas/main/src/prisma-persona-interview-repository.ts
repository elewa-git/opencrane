import { PersonaInterviewState, PersonaQuestionSetState, Prisma, type PrismaClient } from "@prisma/client";

import type { CompletePersonaInterviewCommand, PersonaInterviewRepository, RecordPersonaInterviewAnswerCommand, StartPersonaInterviewCommand } from "./persona-interview-authority.types.js";

/** Prisma authority for the append-only, reviewed-question-set persona interview lifecycle. */
export class PrismaPersonaInterviewRepository implements PersonaInterviewRepository
{
	/** Canonical per-silo product database. */
	private readonly prisma: PrismaClient;

	/** Create the interview authority over the canonical product database. */
	constructor(prisma: PrismaClient)
	{
		this.prisma = prisma;
	}

	/** Start one reviewed interview while serialising all in-progress attempts for the same profile. */
	async startAtomically(command: StartPersonaInterviewCommand): Promise<{ readonly status: "started" | "already_in_progress"; readonly interviewId: string } | { readonly status: "not_found_or_wrong_owner" | "question_set_unavailable" | "persistence_unavailable" }>
	{
		try
		{
			return await this.prisma.$transaction(async function _start(transaction)
			{
				// 1. Lock the owner profile so two browser requests cannot create competing active interviews.
				const profiles = await transaction.$queryRaw<readonly { readonly id: string }[]>(Prisma.sql`SELECT "id" FROM "persona_profiles" WHERE "id" = ${command.personaProfileId} AND "silo_id" = ${command.siloId} AND "user_id" = ${command.userId} FOR UPDATE`);
				if (profiles.length !== 1) return { status: "not_found_or_wrong_owner" } as const;

				// 2. Reuse a still-active interview; starting again must not discard unreviewed user answers.
				const existing = await transaction.personaInterview.findFirst({ where: { personaProfileId: command.personaProfileId, userId: command.userId, state: PersonaInterviewState.InProgress }, select: { id: true } });
				if (existing !== null) return { status: "already_in_progress", interviewId: existing.id } as const;

				// 3. Accept only an exact reviewed question-set revision before recording the interview attempt.
				const questionSet = await transaction.personaQuestionSet.findUnique({ where: { id_version: { id: command.questionSetId, version: command.questionSetVersion } }, select: { state: true } });
				if (questionSet?.state !== PersonaQuestionSetState.Reviewed) return { status: "question_set_unavailable" } as const;
				const interview = await transaction.personaInterview.create({ data: { personaProfileId: command.personaProfileId, userId: command.userId, questionSetId: command.questionSetId, questionSetVersion: command.questionSetVersion, startedAt: new Date(command.startedAt) }, select: { id: true } });
				return { status: "started", interviewId: interview.id } as const;
			});
		}
		catch
		{
			return { status: "persistence_unavailable" };
		}
	}

	/** Append one answer only after locking the exact owner interview and question-set revision. */
	async recordAnswerAtomically(command: RecordPersonaInterviewAnswerCommand): Promise<{ readonly status: "recorded"; readonly answerId: string } | { readonly status: "not_found_or_wrong_owner" | "not_in_progress" | "question_unavailable" | "already_answered" | "persistence_unavailable" }>
	{
		try
		{
			return await this.prisma.$transaction(async function _record(transaction)
			{
				// 1. Lock the interview, proving its owner and keeping completion from racing an answer append.
				const interviews = await transaction.$queryRaw<readonly { readonly questionSetId: string; readonly questionSetVersion: number; readonly state: "in_progress" | "completed" | "retaken" }[]>(Prisma.sql`SELECT "question_set_id" AS "questionSetId", "question_set_version" AS "questionSetVersion", "state" FROM "persona_interviews" WHERE "id" = ${command.interviewId} AND "persona_profile_id" = ${command.personaProfileId} AND "user_id" = ${command.userId} FOR UPDATE`);
				if (interviews.length !== 1) return { status: "not_found_or_wrong_owner" } as const;
				const interview = interviews[0];
				if (interview.state !== "in_progress") return { status: "not_in_progress" } as const;

				// 2. Check the question belongs to the exact reviewed set that was frozen when this interview began.
				const question = await transaction.personaQuestion.findUnique({ where: { questionSetId_questionSetVersion_id: { questionSetId: interview.questionSetId, questionSetVersion: interview.questionSetVersion, id: command.questionId } }, select: { id: true } });
				if (question === null) return { status: "question_unavailable" } as const;
				const existing = await transaction.personaInterviewAnswer.findUnique({ where: { interviewId_questionId: { interviewId: command.interviewId, questionId: command.questionId } }, select: { id: true } });
				if (existing !== null) return { status: "already_answered" } as const;

				// 3. Persist the immutable answer with the question-set provenance the baseline trigger independently verifies.
				const answer = await transaction.personaInterviewAnswer.create({ data: { interviewId: command.interviewId, questionSetId: interview.questionSetId, questionSetVersion: interview.questionSetVersion, questionId: command.questionId, value: command.value.trim(), answeredAt: new Date(command.answeredAt) }, select: { id: true } });
				return { status: "recorded", answerId: answer.id } as const;
			});
		}
		catch (error)
		{
			if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return { status: "already_answered" };
			return { status: "persistence_unavailable" };
		}
	}

	/** Freeze one interview only once its exact reviewed-question set has every answer. */
	async completeAtomically(command: CompletePersonaInterviewCommand): Promise<{ readonly status: "completed" } | { readonly status: "not_found_or_wrong_owner" | "not_in_progress" | "incomplete_answers" | "persistence_unavailable" }>
	{
		try
		{
			return await this.prisma.$transaction(async function _complete(transaction)
			{
				// 1. Lock the interview before counting evidence, sharing the same fence as answer append.
				const interviews = await transaction.$queryRaw<readonly { readonly questionSetId: string; readonly questionSetVersion: number; readonly state: "in_progress" | "completed" | "retaken" }[]>(Prisma.sql`SELECT "question_set_id" AS "questionSetId", "question_set_version" AS "questionSetVersion", "state" FROM "persona_interviews" WHERE "id" = ${command.interviewId} AND "persona_profile_id" = ${command.personaProfileId} AND "user_id" = ${command.userId} FOR UPDATE`);
				if (interviews.length !== 1) return { status: "not_found_or_wrong_owner" } as const;
				const interview = interviews[0];
				if (interview.state !== "in_progress") return { status: "not_in_progress" } as const;

				// 2. Compare the exact reviewed question count with the immutable answers before completion.
				const expectedAnswers = await transaction.personaQuestion.count({ where: { questionSetId: interview.questionSetId, questionSetVersion: interview.questionSetVersion } });
				const actualAnswers = await transaction.personaInterviewAnswer.count({ where: { interviewId: command.interviewId } });
				if (expectedAnswers === 0 || actualAnswers !== expectedAnswers) return { status: "incomplete_answers" } as const;

				// 3. Change only the closed lifecycle state; the target-baseline trigger repeats the answer fence at commit.
				const updated = await transaction.personaInterview.updateMany({ where: { id: command.interviewId, personaProfileId: command.personaProfileId, userId: command.userId, state: PersonaInterviewState.InProgress }, data: { state: PersonaInterviewState.Completed, completedAt: new Date(command.completedAt) } });
				return updated.count === 1 ? { status: "completed" } as const : { status: "not_in_progress" } as const;
			});
		}
		catch
		{
			return { status: "persistence_unavailable" };
		}
	}
}
