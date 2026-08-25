import type { AgentControllerRuntimeProfiles } from "@opencrane/backend/agents/runtime/controller";
import type { SkillWorkloadControllerProfiles } from "@opencrane/backend/agents/skills/controller";
import type { McpbValidationControllerOptions } from "@opencrane/backend/agents/mcpb/controller";

/**
 * Carries controller settings after startup validates the process environment.
 * The entrypoint passes these profiles to the agent, skill-workload, and MCPB controllers, so all
 * profiles are validated before any controller starts.
 * @see _ReadConfig
 */
export interface AgentControllerProcessConfig
{
	/** Internal OpenCrane origin used for claim and assignment calls. */
	readonly openCraneInternalUrl: string;
	/** Absolute path of the rotating OpenCrane-audience projected token. */
	readonly controllerTokenPath: string;
	/** Delay after an idle poll or handled error. */
	readonly pollIntervalMilliseconds: number;
	/** Delay between controller-only runs of durable outbox retention. */
	readonly outboxPruneIntervalMilliseconds: number;
	/** Hard timeout independently applied to each OpenCrane or Kubernetes call. */
	readonly requestTimeoutMilliseconds: number;
	/** Immutable runtime profiles, keyed by the profile name the control plane assigns. */
	readonly profiles: AgentControllerRuntimeProfiles;
	/** Immutable profiles for the only governed skill Job classes. */
	readonly skillWorkloadProfiles: SkillWorkloadControllerProfiles;
	/** Keeps the agent controller on the MCPB controller public API instead of its validator Job launcher. */
	readonly mcpbValidatorProfile: McpbValidationControllerOptions["profile"];
}
