/** MCP coordinates that must remain assigned and published before an AgentRun invokes the tool. */
export interface RuntimeMcpEffectEligibilityCommand
{
	/** Silo containing the service, revision, and MCP tool. */
	readonly siloId: string;
	/** AgentService that owns the running revision. */
	readonly agentServiceId: string;
	/** Active AgentRevision that selected the tool. */
	readonly agentRevisionId: string;
	/** Immutable MCP tool revision proposed by the runtime. */
	readonly toolRevisionId: string;
}

/** Rechecks MCP publication and the exact AgentRevision assignment on a caller-owned transaction. */
export interface RuntimeMcpEffectEligibility
{
	/** Returns true only while the exact tool remains assigned to the running revision and published. */
	isEligible(command: RuntimeMcpEffectEligibilityCommand): Promise<boolean>;
}
