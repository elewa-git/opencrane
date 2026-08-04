import { PersonaQuestionSetState, Prisma } from "@prisma/client";

import type { Logger } from "@opencrane/backend/observability";

import { _DoPersonaPersistenceWithTrace } from "../persona-persistence-observability.js";
import { PERSONA_ONBOARDING_QUESTION_SET_ID, PERSONA_ONBOARDING_QUESTION_SET_VERSION } from "./persona-onboarding-catalogue.js";
import { PersonaOnboardingDenialReasons, type EnsurePersonaOnboardingCommand, type EnsurePersonaOnboardingResult, type PersonaOnboardingRepository } from "./persona-onboarding-authority.types.js";
import { PersonaLifecycleOutcomes } from "./persona-lifecycle.types.js";
import type { PersonaPersistenceUnitOfWork } from "./persona-persistence-unit-of-work.types.js";

/** Prisma authority that verifies baseline-owned sources before provisioning the caller profile. */
export class PrismaPersonaOnboardingRepository implements PersonaOnboardingRepository
{
	/** App-owned structured logger for handled provisioning failures. */
	private readonly logger: Logger;
	/** Persona-owned transaction boundary for owner-profile provisioning. */
	private readonly transactions: PersonaPersistenceUnitOfWork;

	/** Create the onboarding provisioning authority over the canonical product database. */
	constructor(logger: Logger, transactions: PersonaPersistenceUnitOfWork)
	{
		this.logger = logger;
		this.transactions = transactions;
	}

	/** Verify the reviewed baseline source and create the authenticated owner's profile exactly once. */
	async ensureAtomically(command: EnsurePersonaOnboardingCommand): Promise<EnsurePersonaOnboardingResult>
	{
		const repository = this;
		const transactions = this.transactions;
		try
		{
			return await _DoPersonaPersistenceWithTrace(this.logger, "persona.onboarding.provision", { siloId: command.siloId }, "Persona onboarding provisioning is unavailable", function _provision()
			{
				return transactions.run(function _runEnsure(transaction)
				{
					return repository._ensureWithinTransaction(transaction as Prisma.TransactionClient, command);
				});
			});
		}
		catch
		{
			return { outcome: PersonaLifecycleOutcomes.Denied, reason: PersonaOnboardingDenialReasons.PersistenceUnavailable };
		}
	}

	/** Verify the reviewed catalogue before provisioning the owner profile in the same transaction. */
	private async _ensureWithinTransaction(transaction: Prisma.TransactionClient, command: EnsurePersonaOnboardingCommand): Promise<EnsurePersonaOnboardingResult>
	{
		// 1. Fail closed unless the immutable product-owned questionnaire revision remains reviewed.
		const source = await transaction.personaQuestionSet.findUnique({ where: { id_version: { id: PERSONA_ONBOARDING_QUESTION_SET_ID, version: PERSONA_ONBOARDING_QUESTION_SET_VERSION } }, select: { state: true } });
		if (source?.state !== PersonaQuestionSetState.Reviewed) return { outcome: PersonaLifecycleOutcomes.Denied, reason: PersonaOnboardingDenialReasons.CatalogueUnavailable };

		// 2. Provision the authenticated owner's profile exactly once after catalogue validation.
		const provisionedAt = new Date(command.provisionedAt);
		const profile = await transaction.personaProfile.upsert({ where: { siloId_userId: { siloId: command.siloId, userId: command.userId } }, create: { siloId: command.siloId, userId: command.userId, createdAt: provisionedAt, updatedAt: provisionedAt }, update: {}, select: { id: true } });
		return { outcome: PersonaLifecycleOutcomes.Ready, personaProfileId: profile.id, questionSet: { id: PERSONA_ONBOARDING_QUESTION_SET_ID, version: PERSONA_ONBOARDING_QUESTION_SET_VERSION } };
	}
}
