/** Persona coordinates that must remain the user's active approved revision. */
export interface RuntimePersonaEffectEligibilityCommand
{
	/** Silo containing the personal Persona profile. */
	readonly siloId: string;
	/** Verified local Principal whose external identity owns the personal profile. */
	readonly principalId: string;
	/** Persona revision frozen into the admitted run. */
	readonly personaRevisionId: string;
}

/** Rechecks the active Persona revision before a runtime may propose a Persona-backed effect. */
export interface RuntimePersonaEffectEligibility
{
	/** Returns the profile id only while the exact approved revision remains active for this principal. */
	findEligibleProfileId(command: RuntimePersonaEffectEligibilityCommand): Promise<string | null>;
}
