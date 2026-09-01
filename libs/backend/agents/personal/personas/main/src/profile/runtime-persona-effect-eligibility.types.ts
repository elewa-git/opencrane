/** Persona coordinates that must remain the user's active approved revision. */
export interface RuntimePersonaEffectEligibilityCommand
{
	/** Silo containing the personal Persona profile. */
	readonly siloId: string;
	/** User whose personal AgentService is running. */
	readonly userId: string;
	/** Persona revision frozen into the admitted run. */
	readonly personaRevisionId: string;
}

/** Rechecks the active Persona revision before a runtime may propose a Persona-backed effect. */
export interface RuntimePersonaEffectEligibility
{
	/** Returns the profile id only while the exact approved revision remains active for this user. */
	findEligibleProfileId(command: RuntimePersonaEffectEligibilityCommand): Promise<string | null>;
}
