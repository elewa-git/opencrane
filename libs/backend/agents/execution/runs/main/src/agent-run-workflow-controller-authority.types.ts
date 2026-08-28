import type { AgentRunWarmRuntimeActivationCommand, AgentRunWarmRuntimeDeletionCommand, AgentRunWarmRuntimeDeletionOutcome, AgentRunWarmRuntimeReadinessCommand, AgentRunWarmRuntimeReservationCommand, AgentRunWorkflowControllerRecord, AgentRunWorkflowObservation, AgentRunTaskInput } from "@opencrane/backend/agents/execution/runs/workflows/contract";
import type { IWorkflowTaskReceipt } from "@opencrane/backend/server/infra/workflows/contract";

import type { AttemptModelKeyIssuerWithRevocation } from "./attempt-model-key.types";

/**
 * Supplies the fixed runtime settings for AgentRun workflow controller operations.
 *
 * The application composition selects these values. A controller task cannot choose a namespace,
 * a workload lifetime, or a model-key issuer for itself.
 */
export interface AgentRunWorkflowControllerAuthorityOptions
{
	/** Names the namespace that contains personal warm runtime Pods. */
	readonly personalRuntimeNamespace: string;
	/** Names the namespace that contains managed warm runtime Pods. */
	readonly managedRuntimeNamespace: string;
	/** Limits how long a saved runtime assignment may remain usable. */
	readonly assignmentTtlMilliseconds: number;
	/** Mints the transient model key after the database transaction has committed. */
	readonly issueAttemptModelKey: AttemptModelKeyIssuerWithRevocation;
}

/** Persists each warm runtime transition inside one caller-owned transaction. */
export interface AgentRunWarmRuntimePersistenceRepository
{
	/** Loads current task and reservation facts. */
	loadForTask(input: AgentRunTaskInput, receipt: IWorkflowTaskReceipt): Promise<AgentRunWorkflowControllerRecord | null>;
	/** Reserves one generic Pod for the current task. */
	reserveWarmPod(input: AgentRunTaskInput, receipt: IWorkflowTaskReceipt, command: AgentRunWarmRuntimeReservationCommand): Promise<"bound" | "idempotent" | "conflict">;
	/** Records the claimed profile after the controller patches the Pod. */
	recordWarmProfileActivation(input: AgentRunTaskInput, receipt: IWorkflowTaskReceipt, command: AgentRunWarmRuntimeActivationCommand): Promise<"bound" | "idempotent" | "conflict">;
	/** Records readiness evidence for the claimed profile. */
	recordWarmReadiness(input: AgentRunTaskInput, receipt: IWorkflowTaskReceipt, command: AgentRunWarmRuntimeReadinessCommand): Promise<"bound" | "idempotent" | "conflict">;
	/** Records deletion intent before the controller removes the Pod. */
	requestWarmPodDeletion(input: AgentRunTaskInput, receipt: IWorkflowTaskReceipt, command: AgentRunWarmRuntimeDeletionCommand): Promise<"bound" | "idempotent" | "conflict">;
	/** Records deletion and revokes the assignment credentials. */
	recordWarmPodDeleted(input: AgentRunTaskInput, receipt: IWorkflowTaskReceipt, command: AgentRunWarmRuntimeDeletionCommand): Promise<AgentRunWarmRuntimeDeletionOutcome>;
	/** Marks the run failed when setup cannot finish. */
	terminalizeFailedTask(input: AgentRunTaskInput, receipt: IWorkflowTaskReceipt): Promise<void>;
	/** Reads the current run outcome for workflow polling. */
	observe(input: AgentRunTaskInput, receipt: IWorkflowTaskReceipt): Promise<AgentRunWorkflowObservation>;
}
