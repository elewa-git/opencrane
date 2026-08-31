import type { AgentRunWarmRuntimeControllerAuthority } from "@opencrane/backend/agents/execution/runs/workflows/contract";
import type { WarmRuntimeKubernetesStore, WarmRuntimePoolProfiles } from "@opencrane/backend/agents/runtime/controller";

/** Supplies the durable authority and Kubernetes pool adapter for warm AgentRuns. */
export interface WarmAgentRunWorkflowHandlerOptions
{
	/** Owns receipt fences, reservations, readiness, and deletion state. */
	readonly authority: AgentRunWarmRuntimeControllerAuthority;
	/** Lists and changes only Helm-owned warm Pods. */
	readonly kubernetes: WarmRuntimeKubernetesStore;
	/** Maps server-selected workload profiles to fixed pool profiles. */
	readonly profiles: WarmRuntimePoolProfiles;
	/** Delays pool-miss and lifecycle polls without growing one process-local loop. */
	readonly pollIntervalMilliseconds: number;
}
