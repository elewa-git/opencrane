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

/** Result of provisioning the caller's profile and the server-owned onboarding catalogue. */
export type EnsurePersonaOnboardingResult =
	| { readonly outcome: "ready"; readonly personaProfileId: string; readonly questionSet: PersonaOnboardingQuestionSet }
	| { readonly outcome: "denied"; readonly reason: "invalid_command" | "catalogue_conflict" | "persistence_unavailable" };

/** Product-database boundary that provisions only the immutable onboarding source and owner profile. */
export interface PersonaOnboardingRepository
{
	/** Returns the caller profile and the reviewed onboarding source, or a fail-closed reason. */
	ensureAtomically(command: EnsurePersonaOnboardingCommand): Promise<EnsurePersonaOnboardingResult>;
}
