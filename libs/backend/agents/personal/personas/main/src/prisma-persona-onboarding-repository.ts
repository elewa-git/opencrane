import { PersonaQuestionSetState, type PrismaClient } from "@prisma/client";

import { ___DoWithTrace } from "@opencrane/observability";
import type { Logger } from "@opencrane/observability";

import { PERSONA_ONBOARDING_QUESTION_SET_ID, PERSONA_ONBOARDING_QUESTION_SET_VERSION } from "./persona-onboarding-catalogue.js";
import type { EnsurePersonaOnboardingCommand, EnsurePersonaOnboardingResult, PersonaOnboardingRepository } from "./persona-onboarding-authority.types.js";

/** Prisma authority that verifies baseline-owned sources before provisioning the caller profile. */
export class PrismaPersonaOnboardingRepository implements PersonaOnboardingRepository
{
	/** Canonical per-silo product database. */
	private readonly prisma: PrismaClient;
	/** App-owned structured logger for handled provisioning failures. */
	private readonly logger: Logger;

	/** Create the onboarding provisioning authority over the canonical product database. */
	constructor(prisma: PrismaClient, logger: Logger)
	{
		this.prisma = prisma;
		this.logger = logger;
	}

	/** Verify the reviewed baseline source and create the authenticated owner's profile exactly once. */
	async ensureAtomically(command: EnsurePersonaOnboardingCommand): Promise<EnsurePersonaOnboardingResult>
	{
		const prisma = this.prisma;
		const logger = this.logger;
		try
		{
			return await ___DoWithTrace("persona.onboarding.provision", { siloId: command.siloId }, async function _provision()
			{
				try
				{
					return await prisma.$transaction(async function _ensure(transaction)
					{
						const source = await transaction.personaQuestionSet.findUnique({ where: { id_version: { id: PERSONA_ONBOARDING_QUESTION_SET_ID, version: PERSONA_ONBOARDING_QUESTION_SET_VERSION } }, select: { state: true } });
						if (source?.state !== PersonaQuestionSetState.Reviewed) return { outcome: "denied", reason: "catalogue_unavailable" } as const;
						const profile = await transaction.personaProfile.upsert({ where: { siloId_userId: { siloId: command.siloId, userId: command.userId } }, create: { siloId: command.siloId, userId: command.userId, createdAt: new Date(command.provisionedAt), updatedAt: new Date(command.provisionedAt) }, update: {}, select: { id: true } });
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
