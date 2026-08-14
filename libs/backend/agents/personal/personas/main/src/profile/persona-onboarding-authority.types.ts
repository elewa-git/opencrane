import { PersonaLifecycleOutcomes } from "./persona-lifecycle.types";

/** Reasons onboarding provisioning refuses a request. */
export enum PersonaOnboardingDenialReasons
{
	/** The request omitted an owner coordinate or trusted provisioning instant. */
	InvalidCommand = "invalid_command",
	/** The question set, scoring policy, or interpolation map is missing, or the question set is not Reviewed. */
	CatalogueUnavailable = "catalogue_unavailable",
	/** The database call failed. */
	PersistenceUnavailable = "persistence_unavailable",
}

/** Authenticated owner for a personal persona onboarding flow. */
export interface EnsurePersonaOnboardingCommand
{
	/** Silo selected by the authenticated request host. */
	readonly siloId: string;
	/** Stable authenticated subject who owns the persona profile. */
	readonly userId: string;
	/** Server timestamp used when a new profile is created. */
	readonly provisionedAt: string;
}

/** The question set and version the server picks for a persona interview. */
export interface PersonaOnboardingQuestionSet
{
	/** Stable product-owned questionnaire identifier. */
	readonly id: string;
	/** Immutable reviewed questionnaire revision. */
	readonly version: number;
}

/** The scoring policy and interpolation map an interview is pinned to when it starts. */
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

/** Checks that the server-owned question set and derivation sources exist, then creates the owner's profile if it is missing. */
export interface PersonaOnboardingRepository
{
	/** Returns the caller's profile plus the question set and derivation sources, or a refusal reason. */
	ensureAtomically(command: EnsurePersonaOnboardingCommand): Promise<EnsurePersonaOnboardingResult>;
}
