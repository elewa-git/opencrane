import { randomUUID } from "node:crypto";

import { PersonaQuestionSetState, Prisma } from "@prisma/client";

import { PERSONA_INTERPOLATION_MAP_ID, PERSONA_INTERPOLATION_MAP_VERSION, PERSONA_ONBOARDING_QUESTION_SET_ID, PERSONA_ONBOARDING_QUESTION_SET_VERSION, PERSONA_SCORING_POLICY_ID, PERSONA_SCORING_POLICY_VERSION } from "./persona-onboarding-catalogue";
import { PersonaOnboardingDenialReasons, type EnsurePersonaOnboardingCommand, type EnsurePersonaOnboardingResult, type PersonaOnboardingRepository } from "./persona-onboarding-authority.types";
import { PersonaLifecycleOutcomes } from "./persona-lifecycle.types";
import type { PersonaProductAuthorizationRepository } from "./persona-product-authorization.types";

/** Prisma adapter that checks the seeded question set, scoring policy, and interpolation map exist, then creates the caller's profile. */
export class PrismaPersonaOnboardingRepository implements PersonaOnboardingRepository
{
	/** Transaction-scoped ORM client supplied only by the persona unit of work. */
	private readonly transaction: Prisma.TransactionClient;
	/** Central product authority sharing this onboarding transaction. */
	private readonly authorization: PersonaProductAuthorizationRepository;

	/** Create the onboarding provisioning authority over one caller-owned transaction. */
	constructor(transaction: Prisma.TransactionClient, authorization: PersonaProductAuthorizationRepository)
	{
		this.transaction = transaction;
		this.authorization = authorization;
	}

	/** Checks the seeded sources, then creates the owner's profile if it does not already exist. */
	async ensureAtomically(command: EnsurePersonaOnboardingCommand): Promise<EnsurePersonaOnboardingResult>
	{
		return this._ensureWithinTransaction(command);
	}

	/** Checks the seeded sources, then creates the owner's profile if it does not already exist, both in the caller's transaction. */
	private async _ensureWithinTransaction(command: EnsurePersonaOnboardingCommand): Promise<EnsurePersonaOnboardingResult>
	{
		// 1. Refuse unless the question set exists at this version and is still Reviewed, and both derivation sources exist.
		const [source, scoringPolicy, interpolationMap] = await Promise.all([
			this.transaction.personaQuestionSet.findUnique({ where: { id_version: { id: PERSONA_ONBOARDING_QUESTION_SET_ID, version: PERSONA_ONBOARDING_QUESTION_SET_VERSION } }, select: { state: true } }),
			this.transaction.personaScoringPolicy.findUnique({ where: { id_version: { id: PERSONA_SCORING_POLICY_ID, version: PERSONA_SCORING_POLICY_VERSION } }, select: { digest: true } }),
			this.transaction.personaInterpolationMap.findUnique({ where: { id_version: { id: PERSONA_INTERPOLATION_MAP_ID, version: PERSONA_INTERPOLATION_MAP_VERSION } }, select: { digest: true } }),
		]);
		if (source?.state !== PersonaQuestionSetState.Reviewed || scoringPolicy === null || interpolationMap === null) return { outcome: PersonaLifecycleOutcomes.Denied, reason: PersonaOnboardingDenialReasons.CatalogueUnavailable };

		// 2. Return the existing owner profile without replaying its collection creation admission.
		const provisionedAt = new Date(command.provisionedAt);
		const existing = await this.transaction.personaProfile.findUnique({ where: { siloId_userId: { siloId: command.siloId, userId: command.userId } }, select: { id: true } });
		if (existing !== null)
			return { outcome: PersonaLifecycleOutcomes.Ready, personaProfileId: existing.id, questionSet: { id: PERSONA_ONBOARDING_QUESTION_SET_ID, version: PERSONA_ONBOARDING_QUESTION_SET_VERSION }, derivation: { scoringPolicyId: PERSONA_SCORING_POLICY_ID, scoringPolicyVersion: PERSONA_SCORING_POLICY_VERSION, interpolationMapId: PERSONA_INTERPOLATION_MAP_ID, interpolationMapVersion: PERSONA_INTERPOLATION_MAP_VERSION } };

		// 3. Admit collection creation, create the profile, and project its creator grants atomically.
		const caller = { siloId: command.siloId, principalId: command.principalId };
		if (!await this.authorization.admitCollectionCreate(caller))
			return { outcome: PersonaLifecycleOutcomes.Denied, reason: PersonaOnboardingDenialReasons.NotAuthorized };
		const profile = await this.transaction.personaProfile.create({ data: { id: randomUUID(), siloId: command.siloId, userId: command.userId, createdAt: provisionedAt, updatedAt: provisionedAt }, select: { id: true } });
		await this.authorization.reconcileCreator(caller, profile.id, provisionedAt);
		return { outcome: PersonaLifecycleOutcomes.Ready, personaProfileId: profile.id, questionSet: { id: PERSONA_ONBOARDING_QUESTION_SET_ID, version: PERSONA_ONBOARDING_QUESTION_SET_VERSION }, derivation: { scoringPolicyId: PERSONA_SCORING_POLICY_ID, scoringPolicyVersion: PERSONA_SCORING_POLICY_VERSION, interpolationMapId: PERSONA_INTERPOLATION_MAP_ID, interpolationMapVersion: PERSONA_INTERPOLATION_MAP_VERSION } };
	}
}
