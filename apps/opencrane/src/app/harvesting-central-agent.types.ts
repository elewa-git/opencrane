import type { AgentRevisionContent, CreateAgentScheduleCommand } from "@opencrane/backend/server/agents/agent-services";

/** Packaged managed-agent data for the scheduled knowledge harvester. */
export interface HarvestingCentralAgentDefinition
{
	/** Human-readable managed-service name. */
	readonly name: string;
	/** Named workload profile projecting the managed runtime policy. */
	readonly workloadProfile: string;
	/** Immutable executable content of the first Draft revision. */
	readonly content: AgentRevisionContent;
	/** The recurring schedule that will admit runs of the published revision. */
	readonly schedule: Omit<CreateAgentScheduleCommand, "siloId" | "agentServiceId">;
}
