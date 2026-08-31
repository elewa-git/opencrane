/** Runtime execution coordinates that must still identify the active published service revision. */
export interface RuntimeAgentEffectEligibilityCommand
{
	/** Silo that owns the run and AgentService. */
	readonly siloId: string;
	/** AgentService assigned to the current run. */
	readonly agentServiceId: string;
	/** Published revision assigned to the current run. */
	readonly agentRevisionId: string;
	/** Whether the frozen identity represents a person or a managed service. */
	readonly executionKind: "personal" | "managed";
	/** Local Principal that will authorize the external effect. */
	readonly principalId: string;
}

/** Rechecks the AgentService lifecycle before a runtime may create new outside work. */
export interface RuntimeAgentEffectEligibility
{
	/** Returns true only while the exact assigned revision remains the service's active published revision. */
	isEligible(command: RuntimeAgentEffectEligibilityCommand): Promise<boolean>;
}
