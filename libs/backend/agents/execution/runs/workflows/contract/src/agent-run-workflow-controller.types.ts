import type { IWorkflowTaskReceipt } from "@opencrane/backend/server/infra/workflows/contract";

import type { AgentRunTaskInput } from "./agent-run-task.types";

/**
 * Names the server-owned lifecycle result visible to one saved AgentRun task.
 *
 * Completed, failed, and cancelled end the task. Running makes the controller wait and ask again.
 * Stale means a retry replaced this task's attempt, so it must stop without touching Kubernetes.
 */
export type AgentRunWorkflowObservation = "completed" | "failed" | "cancelled" | "running" | "stale";

/**
 * Holds non-secret facts the server approves for one fixed runtime Job.
 *
 * The controller reloads this record instead of checkpointing it, so cancellation or retry takes
 * effect after a workflow restart. The values must still match the task input before Job creation.
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
	/** Names the opaque bootstrap row the runtime may exchange after its Pod is bound. */
	readonly bootstrapReference: string;
	/** Limits the Job lifetime after it is released. */
	readonly assignmentExpiresAt: string;
}

/**
 * Holds the transient model key returned only while the controller creates the Job-owned Secret.
 *
 * The controller passes it straight to Kubernetes and never records it in workflow checkpoints or
 * logs. A replay receives the same key for the same task and bootstrap reference, because an
 * immutable already-created Secret cannot be read or replaced.
 */
export interface AgentRunWorkflowAttemptKey
{
	/** Carries the model key value; callers must not save or log it. */
	readonly key: string;
}

/**
 * Records the immutable Job identity after Kubernetes creates or adopts the suspended Job.
 *
 * The server accepts this only for the task's current run and profile. A conflict means another
 * task or retry owns the assignment, so the controller must not repair or replace that Job.
 */
export interface AgentRunWorkflowAssignmentCommand
{
	/** Names the immutable Job UID Kubernetes returned. */
	readonly workloadUid: string;
	/** Names the selected fixed runtime profile. */
	readonly workloadProfile: string;
	/** Names the ServiceAccount the released Pod must use. */
	readonly serviceAccountName: string;
}

/**
 * Records the first Pod identity after the controller releases the recorded Job.
 *
 * A different Pod is a conflict, not a retry, because the runtime bootstrap exchange must bind to
 * exactly one Pod for each AgentRun attempt.
 */
export interface AgentRunWorkflowPodCommand
{
	/** Names the immutable Job UID already bound by the server. */
	readonly workloadUid: string;
	/** Names the immutable UID of the one Job-owned Pod. */
	readonly podUid: string;
}

/**
 * Binds one server-fenced release permission to the Job the controller is about to unsuspend.
 *
 * Cancellation may refuse this claim after Job assignment. Its expiry limits the Kubernetes release
 * independently from the runtime assignment lifetime, so a delayed controller cannot extend work.
 */
export interface AgentRunWorkflowReleaseClaim
{
	/** Ends the release permission before the runtime assignment itself expires. */
	readonly expiresAt: string;
}

/**
 * Defines the server operations the controller task may request for one saved attempt.
 *
 * The server owns task receipt checks, lifecycle state, bindings, and release fences. Null means
 * cancellation or retry won; conflict means the task must stop rather than act on another attempt.
 *
 * Called by: `__CreateAgentRunWorkflowHandler`.
 */
export interface AgentRunWorkflowControllerAuthority
{
	/** Reloads current task-bound facts without caching them; null means cancellation or retry made this task stale. */
	loadForTask(input: AgentRunTaskInput, task: IWorkflowTaskReceipt): Promise<AgentRunWorkflowControllerRecord | null>;
	/** Mints the same transient attempt key for every replay of this task and bootstrap reference. */
	mintAttemptKey(input: AgentRunTaskInput, task: IWorkflowTaskReceipt): Promise<AgentRunWorkflowAttemptKey | null>;
	/** Binds the suspended Job UID before the controller can release it. */
	bindAssignment(input: AgentRunTaskInput, task: IWorkflowTaskReceipt, command: AgentRunWorkflowAssignmentCommand): Promise<"bound" | "idempotent" | "conflict">;
	/** Binds the first exact Job-owned Pod before it may exchange the bootstrap reference. */
	bindFirstPod(input: AgentRunTaskInput, task: IWorkflowTaskReceipt, command: AgentRunWorkflowPodCommand): Promise<"bound" | "idempotent" | "conflict">;
	/** Takes the server-fenced permission to unsuspend this already-bound Job, or null after cancellation. */
	claimRelease(input: AgentRunTaskInput, task: IWorkflowTaskReceipt, workloadUid: string): Promise<AgentRunWorkflowReleaseClaim | null>;
	/** Reads the current terminal state without changing it. */
	observe(input: AgentRunTaskInput, task: IWorkflowTaskReceipt): Promise<AgentRunWorkflowObservation>;
}
