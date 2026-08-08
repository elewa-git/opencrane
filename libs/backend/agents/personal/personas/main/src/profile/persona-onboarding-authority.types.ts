import { PersonaLifecycleOutcomes } from "./persona-lifecycle.types.js";

/** Stable provisioning denials from the owner-profile and reviewed-catalogue authority. */
export enum PersonaOnboardingDenialReasons
{
	/** The request omitted an owner coordinate or trusted provisioning instant. */
	InvalidCommand = "invalid_command",
	/** The required reviewed onboarding catalogue is absent or not reviewed. */
	CatalogueUnavailable = "catalogue_unavailable",
	/** The persistence authority could not prove a durable provisioning result. */
	PersistenceUnavailable = "persistence_unavailable",
}

/** Authenticated owner for a personal persona onboarding flow. */
export interface EnsurePersonaOnboardingCommand
{
	/** Silo selected by the authenticated request host. */
	readonly siloId: string;
	/** Stable authenticated subject who owns the persona profile. */
	readonly userId: string;
	/** Trusted instant used when a new profile or catalogue is first recorded. */
	readonly provisionedAt: string;
}

/** Server-owned reviewed questionnaire revision used for the first personal persona interview. */
export interface PersonaOnboardingQuestionSet
{
	/** Stable product-owned questionnaire identifier. */
	readonly id: string;
	/** Immutable reviewed questionnaire revision. */
	readonly version: number;
}

/** Exact reviewed derivation sources pinned when an interview starts. */
export interface PersonaOnboardingDerivationSources
{
	/** Stable weighted-scoring policy identifier. */
	readonly scoringPolicyId: string;
	/** Immutable weighted-scoring policy revision. */
	readonly scoringPolicyVersion: number;
	/** Stable interpolation-map identifier. */
	readonly interpolationMapId: string;
	/** Immutable interpolation-map revision. */
	readonly interpolationMapVersion: number;
}

/** Result of provisioning the caller's profile and the server-owned onboarding catalogue. */
export type EnsurePersonaOnboardingResult =
	| { readonly outcome: PersonaLifecycleOutcomes.Ready; readonly personaProfileId: string; readonly questionSet: PersonaOnboardingQuestionSet; readonly derivation: PersonaOnboardingDerivationSources }
	| { readonly outcome: PersonaLifecycleOutcomes.Denied; readonly reason: PersonaOnboardingDenialReasons };

/** Product-database boundary that verifies the clean-baseline source and provisions an owner profile. */
export interface PersonaOnboardingRepository
{
	/** Returns the caller profile and the reviewed onboarding source, or a fail-closed reason. */
	ensureAtomically(command: EnsurePersonaOnboardingCommand): Promise<EnsurePersonaOnboardingResult>;
}
