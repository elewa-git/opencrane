import { PersonaRevisionState, type PrismaClient } from "@prisma/client";

import { PersonaOnboardingApiStates } from "./persona-lifecycle.types.js";
import type { PersonaOnboardingStatus, PersonaOnboardingStatusRepository } from "./persona-onboarding-status.types.js";

/** Prisma read adapter for the exact owner's resumable onboarding state. */
export class PrismaPersonaOnboardingStatusRepository implements PersonaOnboardingStatusRepository
{
	/** Canonical product database client. */
	private readonly _prisma: PrismaClient;

	/** Construct the status reader over the app-owned Prisma client. */
	constructor(prisma: PrismaClient)
	{
		this._prisma = prisma;
	}

	/** Read the latest interview and revision without exposing compiled persona instructions. */
	async readStatus(siloId: string, userId: string): Promise<PersonaOnboardingStatus>
	{
		const profile = await this._prisma.personaProfile.findUnique({ where: { siloId_userId: { siloId, userId } }, include: { interviews: { orderBy: { startedAt: "desc" }, take: 1, include: { answers: { select: { id: true }, }, questionSet: { include: { questions: { select: { id: true } } } } }, } } });
		if (profile === null) return { state: PersonaOnboardingApiStates.Interview, interviewId: null, answeredQuestionCount: 0, questionCount: 0, personaRevisionId: null };
		const interview = profile.interviews[0] ?? null;
		if (interview !== null)
		{
			const revision = await this._prisma.personaRevision.findFirst({ where: { personaProfileId: profile.id, interviewId: interview.id }, orderBy: { revision: "desc" }, select: { id: true, state: true } });
			if (revision?.state === PersonaRevisionState.Draft) return { state: PersonaOnboardingApiStates.Review, interviewId: interview.id, answeredQuestionCount: interview.answers.length, questionCount: interview.questionSet.questions.length, personaRevisionId: revision.id };
			return { state: PersonaOnboardingApiStates.Interview, interviewId: interview.id, answeredQuestionCount: interview.answers.length, questionCount: interview.questionSet.questions.length, personaRevisionId: null };
		}
		return profile.activeRevisionId === null
			? { state: PersonaOnboardingApiStates.Interview, interviewId: null, answeredQuestionCount: 0, questionCount: 0, personaRevisionId: null }
			: { state: PersonaOnboardingApiStates.Ready, interviewId: null, answeredQuestionCount: 0, questionCount: 0, personaRevisionId: profile.activeRevisionId };
	}
}
