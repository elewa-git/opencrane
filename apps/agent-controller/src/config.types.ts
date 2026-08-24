import type { AgentControllerRuntimeProfiles } from "@opencrane/backend/agents/runtime/controller";
import type { SkillWorkloadControllerProfiles } from "@opencrane/backend/agents/skills/controller";
import type { McpbValidatorJobProfile } from "@opencrane/backend/server/gateways/mcp/validator-k8s-launcher";

/** Fully validated process configuration for the per-silo agent controller. */
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
	/** Immutable profile for the only MCP bundle validator Job class. */
	readonly mcpbValidatorProfile: McpbValidatorJobProfile;
}
