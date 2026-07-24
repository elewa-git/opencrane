import type { PrismaClient } from "@prisma/client";
import { PersonaQuestionSetState } from "@prisma/client";

import type { PersonaOnboardingCaller, PersonaOnboardingQuestionSet, PersonaOnboardingSourceRepository, PersonaProfileRepository } from "./persona-onboarding.types.js";

/** Fixed reviewed source selected by the product rather than an HTTP caller. */
const _INITIAL_QUESTION_SET_ID = "personal-agent-onboarding";

/** Fixed version of the clean-build onboarding source. */
const _INITIAL_QUESTION_SET_VERSION = 1;

/** Prisma adapter for server-side persona-profile resolution and reviewed source reads. */
export class PrismaPersonaOnboardingRepository implements PersonaProfileRepository, PersonaOnboardingSourceRepository
{
	/** Canonical product-database client injected by the composing application. */
	private readonly prisma: PrismaClient;

	/** Construct the adapter over the canonical product database. */
	constructor(prisma: PrismaClient)
	{
		this.prisma = prisma;
	}

	/** Find or create exactly one profile for the authenticated person in the current silo. */
	async resolveForCaller(caller: PersonaOnboardingCaller): Promise<{ readonly id: string }>
	{
		return this.prisma.personaProfile.upsert({
			where: { siloId_userId: { siloId: caller.siloId, userId: caller.userId } },
			create: { siloId: caller.siloId, userId: caller.userId },
			update: {},
			select: { id: true },
		});
	}

	/** Load the exact reviewed clean-build interview source in durable display order. */
	async getReviewedQuestionSet(): Promise<PersonaOnboardingQuestionSet | null>
	{
		const questionSet = await this.prisma.personaQuestionSet.findUnique({
			where: { id_version: { id: _INITIAL_QUESTION_SET_ID, version: _INITIAL_QUESTION_SET_VERSION } },
			select: { id: true, version: true, state: true, questions: { orderBy: { ordinal: "asc" }, select: { id: true, category: true, prompt: true, ordinal: true } } },
		});
		if (questionSet?.state !== PersonaQuestionSetState.Reviewed || questionSet.questions.length === 0) return null;
		return { id: questionSet.id, version: questionSet.version, questions: questionSet.questions };
	}
}
