import type { AgentRunWarmRuntimeActivationCommand, AgentRunWarmRuntimeDeletionCommand, AgentRunWarmRuntimeDeletionOutcome, AgentRunWarmRuntimeReadinessCommand, AgentRunWarmRuntimeReplacementOutcome, AgentRunWarmRuntimeReservationCommand, AgentRunWarmRuntimeUnreservedCancellationOutcome, AgentRunWorkflowControllerRecord, AgentRunWorkflowObservation, AgentRunTaskInput } from "@opencrane/backend/agents/execution/runs/workflows/contract";
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
	/** Checks a waiting continuation and advances its stream fence on the replacement transaction. */
	readonly continuationRecovery: AgentRunRuntimeContinuationRecoveryPort;
}

/**
 * Lets the AgentRun lifecycle prove that a waiting attempt can continue on a replacement Pod.
 *
 * The caller passes its current database transaction so continuation validation, stream fencing,
 * credential revocation, and the Pod-generation change commit together. A null result means the
 * lifecycle must move the run to `RecoveryRequired` instead of replaying it.
 */
export interface AgentRunRuntimeContinuationRecoveryPort
{
	/** Returns true after validation and fencing, or null when replacement cannot safely resume. */
	prepareReplacementInTransaction(transaction: unknown, runId: string, attempt: number): Promise<true | null>;
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
	/** Fences a dead current binding and advances its generation only after continuation validation. */
	prepareWarmRuntimeReplacement(input: AgentRunTaskInput, receipt: IWorkflowTaskReceipt, command: AgentRunWarmRuntimeDeletionCommand, continuationAvailable: boolean): Promise<AgentRunWarmRuntimeReplacementOutcome>;
	/** Finalizes cancellation after proving the exact attempt has no warm reservation or assignment. */
	finalizeCancellationWithoutWarmReservation(input: AgentRunTaskInput, receipt: IWorkflowTaskReceipt): Promise<AgentRunWarmRuntimeUnreservedCancellationOutcome>;
	/** Marks the run failed when setup cannot finish. */
	terminalizeFailedTask(input: AgentRunTaskInput, receipt: IWorkflowTaskReceipt): Promise<void>;
	/** Reads the current run outcome for workflow polling. */
	observe(input: AgentRunTaskInput, receipt: IWorkflowTaskReceipt): Promise<AgentRunWorkflowObservation>;
}
