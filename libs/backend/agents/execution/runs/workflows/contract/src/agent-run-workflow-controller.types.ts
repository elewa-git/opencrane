import type { IWorkflowTaskReceipt } from "@opencrane/backend/server/infra/workflows/contract";

import type { AgentRunTaskInput } from "./agent-run-task.types";

/**
 * Names the server-owned lifecycle result visible to one saved AgentRun task.
 *
 * Completed, failed, and cancelled end the task. Running makes the controller wait and ask again.
 * Stale means a retry replaced this task's attempt, so it must stop without touching Kubernetes.
 */
export type AgentRunWorkflowObservation = "completed" | "failed" | "cancelling" | "cancelled" | "running" | "waiting_for_input" | "recovery_required" | "stale";

/**
 * Holds non-secret facts the server approves for one fixed warm runtime claim.
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
	/** Selects the current Pod binding without changing the stable logical assignment. */
	readonly bindingGeneration: number;
	/** Limits how long the warm runtime claim may remain usable. */
	readonly assignmentExpiresAt: string;
	/** Carries one older one-use Pod whose saved deletion must finish before another claim starts. */
	readonly pendingDeletion?: AgentRunWarmRuntimeDeletionCommand;
	/** Reports the server-owned lifecycle observed in the same task-fenced read. */
	readonly observation: AgentRunWorkflowObservation;
}

/** Carries one generic warm Pod that Kubernetes has already started. */
export interface AgentRunWarmRuntimeReservationCommand
{
	/** Selects the current binding generation approved by the server. */
	readonly generation: number;
	/** Names the server-selected pool profile for this run. */
	readonly workloadProfile: string;
	/** Names the Helm-owned pool Deployment. */
	readonly deploymentName: string;
	/** Carries the immutable pool Deployment UID. */
	readonly deploymentUid: string;
	/** Names the generic Pod offered for reservation. */
	readonly podName: string;
	/** Carries the immutable Pod UID. */
	readonly podUid: string;
	/** Carries the Pod version that later profile activation must test. */
	readonly podResourceVersion: string;
	/** Names the deployment-owned generic network profile. */
	readonly genericProfile: string;
	/** Names the deployment-owned claimed network profile. */
	readonly claimedProfile: string;
	/** Names the credential-free warm runtime ServiceAccount. */
	readonly serviceAccountName: string;
}

/** Records the conditional profile patch returned by Kubernetes. */
export interface AgentRunWarmRuntimeActivationCommand
{
	/** Names the reserved Pod. */
	readonly podUid: string;
	/** Carries the resource version returned after activation. */
	readonly resourceVersion: string;
	/** Names the claimed profile now projected on the Pod. */
	readonly profile: string;
}

/** Records readiness proved through the selected network path. */
export interface AgentRunWarmRuntimeReadinessCommand extends AgentRunWarmRuntimeActivationCommand
{
	/** Records when the controller completed the readiness probe. */
	readonly observedAt: string;
}

/** Carries the exact used Pod identity for one-way deletion. */
export interface AgentRunWarmRuntimeDeletionCommand
{
	/** Selects the exact historical binding generation being deleted. */
	readonly generation: number;
	/** Names the used Pod. */
	readonly podName: string;
	/** Carries the immutable Pod UID used as a delete precondition. */
	readonly podUid: string;
	/** Carries the immutable owning Deployment UID. */
	readonly deploymentUid: string;
	/** Names the generic or claimed profile expected before deletion. */
	readonly profile: string;
}

/** Reports whether exact Pod deletion finished, must be retried, or lost its authority fence. */
export type AgentRunWarmRuntimeDeletionOutcome = "bound" | "idempotent" | "deferred" | "conflict";

/**
 * Tells the workflow what to do after the claimed Pod disappears or reaches a terminal phase.
 *
 * `replace` means a waiting continuation was checked and the next Pod generation may be reserved.
 * `recovery_required` means replay could repeat active model work or no usable continuation exists;
 * the workflow waits for operator recovery. `conflict` means this task lost its saved binding and
 * must stop without changing Kubernetes again.
 */
export type AgentRunWarmRuntimeReplacementOutcome = "replace" | "recovery_required" | "conflict";

/**
 * Reports how the workflow must continue when cancellation reaches an attempt with no loaded Pod.
 *
 * `bound` and `idempotent` mean cancellation is final. `deferred` tells the handler to retry while
 * a provider claim settles. `reservation_exists` sends the handler through the saved Pod deletion
 * path. `conflict` means the task receipt lost its authority fence and must stop terminally.
 *
 * Called by: `_FinalizeUnreservedCancellation` in the warm AgentRun workflow handler and the
 * controller-only HTTP adapter that transports the server decision.
 */
export type AgentRunWarmRuntimeUnreservedCancellationOutcome = AgentRunWarmRuntimeDeletionOutcome | "reservation_exists";

/** Defines the server operations used by the hard-cutoff warm AgentRun workflow. */
export interface AgentRunWarmRuntimeControllerAuthority
{
	/** Reloads current task-bound facts before a handler reserves a generic Pod. */
	loadForTask(input: AgentRunTaskInput, task: IWorkflowTaskReceipt): Promise<AgentRunWorkflowControllerRecord | null>;
	/** Reserves one generic Pod in the database, or rejects a candidate another task already won. */
	reserveWarmPod(input: AgentRunTaskInput, task: IWorkflowTaskReceipt, command: AgentRunWarmRuntimeReservationCommand): Promise<"bound" | "idempotent" | "conflict">;
	/** Saves the conditional Kubernetes profile activation for the reserved Pod. */
	recordWarmProfileActivation(input: AgentRunTaskInput, task: IWorkflowTaskReceipt, command: AgentRunWarmRuntimeActivationCommand): Promise<"bound" | "idempotent" | "conflict">;
	/** Saves readiness only after the controller probes the selected network path. */
	recordWarmReadiness(input: AgentRunTaskInput, task: IWorkflowTaskReceipt, command: AgentRunWarmRuntimeReadinessCommand): Promise<"bound" | "idempotent" | "conflict">;
	/** Records the one-way deletion command before Kubernetes mutation. */
	requestWarmPodDeletion(input: AgentRunTaskInput, task: IWorkflowTaskReceipt, command: AgentRunWarmRuntimeDeletionCommand): Promise<"bound" | "idempotent" | "conflict">;
	/** Records that the exact used Pod deletion request succeeded. */
	recordWarmPodDeleted(input: AgentRunTaskInput, task: IWorkflowTaskReceipt, command: AgentRunWarmRuntimeDeletionCommand): Promise<AgentRunWarmRuntimeDeletionOutcome>;
	/** Fences a dead binding and decides whether its waiting attempt may resume on a new Pod. */
	prepareWarmRuntimeReplacement(input: AgentRunTaskInput, task: IWorkflowTaskReceipt, command: AgentRunWarmRuntimeDeletionCommand): Promise<AgentRunWarmRuntimeReplacementOutcome>;
	/** Finalizes cancellation only when the exact attempt has no reservation or assignment. */
	finalizeCancellationWithoutWarmReservation(input: AgentRunTaskInput, task: IWorkflowTaskReceipt): Promise<AgentRunWarmRuntimeUnreservedCancellationOutcome>;
	/** Fences this receipt and records a setup failure. */
	terminalizeFailedTask(input: AgentRunTaskInput, task: IWorkflowTaskReceipt): Promise<void>;
	/** Reads current lifecycle state while the claimed Pod is running. */
	observe(input: AgentRunTaskInput, task: IWorkflowTaskReceipt): Promise<AgentRunWorkflowObservation>;
}
