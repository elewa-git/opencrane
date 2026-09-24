import type { ExecutionSubject } from "@opencrane/models/agents";

/** Runtime execution coordinates that must still identify the active published service revision. */
export interface RuntimeAgentEffectEligibilityCommand
{
	/** Silo that owns the run and AgentService. */
	readonly siloId: string;
	/** AgentService assigned to the current run. */
	readonly agentServiceId: string;
	/** Published revision assigned to the current run. */
	readonly agentRevisionId: string;
	/** Checked subject that owns the exact run, identity, Principal, and computer lease. */
	readonly executionSubject: ExecutionSubject;
}

/** Rechecks the AgentService lifecycle before a runtime may create new outside work. */
export interface RuntimeAgentEffectEligibility
{
	/** Returns true only while the exact assigned revision remains the service's active published revision. */
	isEligible(command: RuntimeAgentEffectEligibilityCommand): Promise<boolean>;
}
