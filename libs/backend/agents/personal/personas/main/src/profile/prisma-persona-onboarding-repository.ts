import { PersonaQuestionSetState, Prisma } from "@prisma/client";

import { PERSONA_ONBOARDING_QUESTION_SET_ID, PERSONA_ONBOARDING_QUESTION_SET_VERSION } from "./persona-onboarding-catalogue.js";
import { PersonaOnboardingDenialReasons, type EnsurePersonaOnboardingCommand, type EnsurePersonaOnboardingResult, type PersonaOnboardingRepository } from "./persona-onboarding-authority.types.js";
import { PersonaLifecycleOutcomes } from "./persona-lifecycle.types.js";

/** Prisma authority that verifies baseline-owned sources before provisioning the caller profile. */
export class PrismaPersonaOnboardingRepository implements PersonaOnboardingRepository
{
	/** Transaction-scoped ORM client supplied only by the persona unit of work. */
	private readonly transaction: Prisma.TransactionClient;

	/** Create the onboarding provisioning authority over one caller-owned transaction. */
	constructor(transaction: Prisma.TransactionClient)
	{
		this.transaction = transaction;
	}

	/** Verify the reviewed baseline source and create the authenticated owner's profile exactly once. */
	async ensureAtomically(command: EnsurePersonaOnboardingCommand): Promise<EnsurePersonaOnboardingResult>
	{
		return this._ensureWithinTransaction(command);
	}

	/** Verify the reviewed catalogue before provisioning the owner profile in the same transaction. */
	private async _ensureWithinTransaction(command: EnsurePersonaOnboardingCommand): Promise<EnsurePersonaOnboardingResult>
	{
		// 1. Fail closed unless the immutable product-owned questionnaire revision remains reviewed.
		const source = await this.transaction.personaQuestionSet.findUnique({ where: { id_version: { id: PERSONA_ONBOARDING_QUESTION_SET_ID, version: PERSONA_ONBOARDING_QUESTION_SET_VERSION } }, select: { state: true } });
		if (source?.state !== PersonaQuestionSetState.Reviewed) return { outcome: PersonaLifecycleOutcomes.Denied, reason: PersonaOnboardingDenialReasons.CatalogueUnavailable };

		// 2. Provision the authenticated owner's profile exactly once after catalogue validation.
		const provisionedAt = new Date(command.provisionedAt);
		const profile = await this.transaction.personaProfile.upsert({ where: { siloId_userId: { siloId: command.siloId, userId: command.userId } }, create: { siloId: command.siloId, userId: command.userId, createdAt: provisionedAt, updatedAt: provisionedAt }, update: {}, select: { id: true } });
		return { outcome: PersonaLifecycleOutcomes.Ready, personaProfileId: profile.id, questionSet: { id: PERSONA_ONBOARDING_QUESTION_SET_ID, version: PERSONA_ONBOARDING_QUESTION_SET_VERSION } };
	}
}
