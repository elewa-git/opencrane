import { PersonaQuestionSetState } from "@prisma/client";

import { ___DoWithTrace } from "@opencrane/backend/observability";
import type { Logger } from "@opencrane/backend/observability";

import { PERSONA_ONBOARDING_QUESTION_SET_ID, PERSONA_ONBOARDING_QUESTION_SET_VERSION } from "./persona-onboarding-catalogue.js";
import type { EnsurePersonaOnboardingCommand, EnsurePersonaOnboardingResult, PersonaOnboardingRepository } from "./persona-onboarding-authority.types.js";
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
		const logger = this.logger;
		const transactions = this.transactions;
		try
		{
			return await ___DoWithTrace("persona.onboarding.provision", { siloId: command.siloId }, async function _provision()
			{
				try
				{
					return await transactions.run(async function _ensure(transaction)
					{
						const client = transaction as import("@prisma/client").Prisma.TransactionClient;
						const source = await client.personaQuestionSet.findUnique({ where: { id_version: { id: PERSONA_ONBOARDING_QUESTION_SET_ID, version: PERSONA_ONBOARDING_QUESTION_SET_VERSION } }, select: { state: true } });
						if (source?.state !== PersonaQuestionSetState.Reviewed) return { outcome: "denied", reason: "catalogue_unavailable" } as const;
						const profile = await client.personaProfile.upsert({ where: { siloId_userId: { siloId: command.siloId, userId: command.userId } }, create: { siloId: command.siloId, userId: command.userId, createdAt: new Date(command.provisionedAt), updatedAt: new Date(command.provisionedAt) }, update: {}, select: { id: true } });
						return { outcome: "ready", personaProfileId: profile.id, questionSet: { id: PERSONA_ONBOARDING_QUESTION_SET_ID, version: PERSONA_ONBOARDING_QUESTION_SET_VERSION } } as const;
					});
				}
				catch (err)
				{
					logger.error({ err, siloId: command.siloId }, "Persona onboarding provisioning is unavailable");
					throw err;
				}
			});
		}
		catch
		{
			return { outcome: "denied", reason: "persistence_unavailable" };
		}
	}
}
