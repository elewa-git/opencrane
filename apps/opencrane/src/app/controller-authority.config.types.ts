import type { ControllerAuthorityIdentityPolicy } from "@opencrane/backend/server/runs";

/** Closed server-side configuration required to expose controller authority routes. */
export interface ControllerAuthorityConfig
{
	/** Exact projected-token identity accepted from the controller. */
	readonly identity: ControllerAuthorityIdentityPolicy;
	/** Runtime profiles selected only from persisted AgentService workload-profile keys. */
	readonly runtimeProfiles: ReadonlyMap<string, { readonly namespace: string; readonly serviceAccountName: string; readonly image: string; readonly assignmentTtlMs: number }>;
}
