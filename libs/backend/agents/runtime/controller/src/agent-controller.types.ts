import type { V1Job, V1Pod, V1Secret } from "@kubernetes/client-node";

import type { AgentRuntimeJobProfile } from "@opencrane/backend/agents/runtime/k8s-launcher";

/** Defines one immutable runtime Job profile and the namespace that profile owns. */
export interface AgentControllerRuntimeProfile extends AgentRuntimeJobProfile
{
	/** Names the isolated namespace that holds only this runtime Job class. */
	readonly namespace: string;
}

/** Holds runtime profiles keyed by the server-selected workload profile name. */
export type AgentControllerRuntimeProfiles = Readonly<Record<string, AgentControllerRuntimeProfile>>;

/** Defines the only Kubernetes operations the AgentRun workflow handler may request. */
export interface AgentControllerKubernetesStore
{
	/** Creates the exact suspended Job or adopts an exact immutable replay. */
	__EnsureSuspendedJob(expected: V1Job): Promise<V1Job>;
	/** Creates the Job-owned key Secret without reading or replacing an existing Secret. */
	__EnsureAttemptKeySecret(expected: V1Secret): Promise<"created" | "alreadyExists">;
	/** Releases only the server-bound Job UID before the saved deadline. */
	__EnsureRuntimeJobReleased(expected: V1Job, workloadUid: string, assignmentExpiresAt: string, releaseLeaseExpiresAt: string): Promise<V1Job>;
	/** Returns one exact Job-owned Pod, or null while Kubernetes has not scheduled it. */
	__FindFirstRuntimePod(expectedJob: V1Job, workloadUid: string, serviceAccountName: string): Promise<V1Pod | null>;
}
