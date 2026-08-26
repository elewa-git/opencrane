import type { V1Job, V1Pod, V1Secret } from "@kubernetes/client-node";

import type { AgentRunTaskInput, AgentRunTaskResult } from "@opencrane/backend/agents/execution/runs/workflows/contract";
import type { AgentControllerRuntimeProfiles } from "@opencrane/backend/agents/runtime/controller";
import type { IWorkflowTaskContext, IWorkflowTaskDefinition } from "@opencrane/backend/server/infra/workflows/contract";

/**
 * Reports the current lifecycle state the handler receives from the server for one saved task.
 *
 * `completed`, `failed`, and `cancelled` end the task; `running` makes the handler wait and poll
 * again. `stale` means the saved task no longer owns the current attempt, so the handler reports it
 * as cancelled rather than touching Kubernetes for a later retry.
 */
export type AgentRunWorkflowObservation = "completed" | "failed" | "cancelled" | "running" | "stale";

/**
 * Carries the current server-owned facts needed to build one runtime Job for the admitted task.
 *
 * The handler reloads this record rather than checkpointing it, so cancellation and retry can make
 * the task stale after a workflow-engine restart. Its silo, run, and attempt must still match the
 * saved {@link AgentRunTaskInput} before the handler creates Kubernetes work.
 */
export interface AgentRunWorkflowControllerRecord extends AgentRunTaskInput
{
	/** Identifies the active service whose revision the run must still use. */
	readonly agentServiceId: string;
	/** Identifies the immutable service revision admitted with this attempt. */
	readonly agentRevisionId: string;
	/** Names the deployment-owned runtime profile selected by the server. */
	readonly workloadProfile: string;
	/** Names the isolated namespace selected by that fixed profile. */
	readonly namespace: string;
	/** Names the opaque bootstrap row that the runtime may exchange once its Pod is bound. */
	readonly bootstrapReference: string;
	/** Limits the Job lifetime after it is released. */
	readonly assignmentExpiresAt: string;
}

/**
 * Carries the transient model key while the handler creates the Job-owned Secret.
 *
 * The handler passes this value straight to Kubernetes and never puts it in a checkpoint, which
 * keeps workflow replay data and logs from retaining the key.
 */
export interface AgentRunWorkflowAttemptKey
{
	/** Carries the model key value; callers must not checkpoint or log it. */
	readonly key: string;
}

/**
 * Carries the server's time-limited permission to unsuspend an already-bound Job.
 *
 * Kubernetes uses this expiry together with the assignment expiry, so a delayed release cannot
 * extend the attempt beyond the server's authority.
 */
export interface AgentRunWorkflowReleaseClaim
{
	/** Ends the release permission before the runtime assignment itself expires. */
	readonly expiresAt: string;
}

/** Records the immutable Job identity after Kubernetes creates or adopts the suspended Job. */
export interface AgentRunWorkflowAssignmentCommand
{
	/** Names the immutable Job UID Kubernetes returned. */
	readonly workloadUid: string;
	/** Names the selected fixed runtime profile. */
	readonly workloadProfile: string;
	/** Names the ServiceAccount the released Pod must use. */
	readonly serviceAccountName: string;
}

/** Records the first Pod identity after the controller releases the recorded Job. */
export interface AgentRunWorkflowPodCommand
{
	/** Names the immutable Job UID already bound by the server. */
	readonly workloadUid: string;
	/** Names the immutable UID of the one Job-owned Pod. */
	readonly podUid: string;
}

/**
 * Defines the server operations a saved AgentRun task needs while it reconciles one attempt.
 *
 * The handler uses this port instead of accessing AgentRun rows, so the server remains the lifecycle
 * authority. A `null` load or release claim means cancellation or retry won; a conflicting bind is
 * terminal because the task must not replace another attempt's Job or Pod.
 *
 * Called by: {@link __CreateAgentRunWorkflowHandler}.
 */
export interface AgentRunWorkflowControllerAuthority
{
	/** Reloads current task-bound facts without caching them; null means cancellation or retry made this task stale. */
	loadForTask(input: AgentRunTaskInput, task: IWorkflowTaskContext["task"]): Promise<AgentRunWorkflowControllerRecord | null>;
	/** Mints the same transient attempt key for every replay of this task and bootstrap reference. */
	mintAttemptKey(input: AgentRunTaskInput, task: IWorkflowTaskContext["task"]): Promise<AgentRunWorkflowAttemptKey | null>;
	/** Binds the suspended Job UID before the controller can release it. */
	bindAssignment(input: AgentRunTaskInput, task: IWorkflowTaskContext["task"], command: AgentRunWorkflowAssignmentCommand): Promise<"bound" | "idempotent" | "conflict">;
	/** Binds the first exact Job-owned Pod before it may exchange the bootstrap reference. */
	bindFirstPod(input: AgentRunTaskInput, task: IWorkflowTaskContext["task"], command: AgentRunWorkflowPodCommand): Promise<"bound" | "idempotent" | "conflict">;
	/** Takes the server-fenced permission to unsuspend this already-bound Job, or null after cancellation. */
	claimRelease(input: AgentRunTaskInput, task: IWorkflowTaskContext["task"], workloadUid: string): Promise<AgentRunWorkflowReleaseClaim | null>;
	/** Reads the current terminal state without changing it. */
	observe(input: AgentRunTaskInput, task: IWorkflowTaskContext["task"]): Promise<AgentRunWorkflowObservation>;
}

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
 * names the record's runtime namespace, which prevents the task from moving a Job across namespaces.
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
