import type { V1Job, V1Pod, V1Secret } from "@kubernetes/client-node";

import type { AgentRunTaskInput, AgentRunTaskResult, AgentRunWorkflowControllerAuthority } from "@opencrane/backend/agents/execution/runs/workflows/contract";
import type { AgentControllerRuntimeProfiles } from "@opencrane/backend/agents/runtime/controller";
import type { IWorkflowTaskDefinition } from "@opencrane/backend/server/infra/workflows/contract";

export type { AgentRunWorkflowControllerAuthority } from "@opencrane/backend/agents/execution/runs/workflows/contract";

/**
 * Defines the Kubernetes operations the handler needs for its one server-approved runtime Job.
 *
 * This port can create or adopt the expected suspended Job, then release and observe only the UID
 * the server bound. It does not grant the handler power to choose a profile, create a different
 * workload, or decide an AgentRun lifecycle state.
 *
 * Called by: {@link __CreateAgentRunWorkflowHandler}.
 */
export interface AgentRunWorkflowKubernetesStore
{
	/** Creates or adopts the expected suspended Job. */
	ensureSuspendedJob(expected: V1Job): Promise<V1Job>;
	/** Creates the Job-owned transient key Secret. */
	ensureAttemptKeySecret(expected: V1Secret): Promise<void>;
	/** Releases only the Job UID the server already bound. */
	releaseJob(expected: V1Job, workloadUid: string, assignmentExpiresAt: string, releaseExpiresAt: string): Promise<V1Job>;
	/** Returns the first exact Job-owned Pod, or null while Kubernetes has not scheduled it. */
	findFirstPod(expected: V1Job, workloadUid: string, serviceAccountName: string): Promise<V1Pod | null>;
}

/**
 * Supplies the handler's server, Kubernetes, profile, and polling dependencies.
 *
 * The handler accepts a server-selected profile only when it resolves in this deployment map and
 * names the record's runtime namespace. This stops the task moving a Job across namespaces.
 */
export interface AgentRunWorkflowHandlerOptions
{
	/** Calls the server authority that owns task receipt, lifecycle, and bindings. */
	readonly authority: AgentRunWorkflowControllerAuthority;
	/** Mutates only the profile-constrained runtime Job. */
	readonly kubernetes: AgentRunWorkflowKubernetesStore;
	/** Holds deployment-owned profiles that the server-selected name must resolve to. */
	readonly profiles: AgentControllerRuntimeProfiles;
	/** Delays each retry while waiting for the first Pod or terminal result. */
	readonly pollIntervalMilliseconds: number;
}

/** Names the factory that creates a saved-task executor for one AgentRun attempt. */
export type CreateAgentRunWorkflowHandler = (options: AgentRunWorkflowHandlerOptions) => IWorkflowTaskDefinition<AgentRunTaskInput, AgentRunTaskResult>;
