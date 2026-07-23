import { PersonaInterviewState, PersonaQuestionSetState, type Prisma } from "@prisma/client";

import type { StartPersonaInterviewWithinTransactionCommand, StartPersonaInterviewWithinTransactionResult } from "./persona-interview-authority.types.js";

/** Locates one linked or active interview, or creates a new interview from an exact reviewed question set. */
export async function __StartPersonaInterviewWithinTransaction(transaction: Prisma.TransactionClient, command: StartPersonaInterviewWithinTransactionCommand): Promise<StartPersonaInterviewWithinTransactionResult>
{
	// 1. Prefer the exact refresh link, so retried refresh requests never claim unrelated onboarding evidence.
	if (command.refreshChangeId !== undefined)
	{
		const linked = await transaction.personaInterview.findUnique({ where: { refreshChangeId: command.refreshChangeId }, select: { id: true, state: true } });
		if (linked !== null) return linked.state === PersonaInterviewState.InProgress ? { status: "linked_in_progress", interviewId: linked.id } : { status: "linked_closed" };
	}

	// 2. Preserve an existing active interview because its pending answers are still the user's evidence.
	const active = await transaction.personaInterview.findFirst({ where: { personaProfileId: command.personaProfileId, userId: command.userId, state: PersonaInterviewState.InProgress }, select: { id: true } });
	if (active !== null) return { status: "other_in_progress", interviewId: active.id };

	// 3. Create only from an immutable reviewed question-set revision, which the baseline repeats independently.
	const questionSet = await transaction.personaQuestionSet.findUnique({ where: { id_version: { id: command.questionSetId, version: command.questionSetVersion } }, select: { state: true } });
	if (questionSet?.state !== PersonaQuestionSetState.Reviewed) return { status: "question_set_unavailable" };
	const interview = await transaction.personaInterview.create({ data: { personaProfileId: command.personaProfileId, userId: command.userId, refreshChangeId: command.refreshChangeId, questionSetId: command.questionSetId, questionSetVersion: command.questionSetVersion, startedAt: new Date(command.startedAt) }, select: { id: true } });
	return { status: "started", interviewId: interview.id };
}
