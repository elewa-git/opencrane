import type { AgentRunWorkflowAssignmentCommand, AgentRunWorkflowControllerRecord, AgentRunWorkflowObservation, AgentRunWorkflowPodCommand, AgentRunWorkflowReleaseClaim, AgentRunTaskInput } from "@opencrane/backend/agents/execution/runs/workflows/contract";
import type { IWorkflowTaskReceipt } from "@opencrane/backend/server/infra/workflows/contract";

import type { AttemptModelKeyIssuerWithRevocation, AttemptModelKeyMintRequest } from "./attempt-model-key.types";

/**
 * Supplies the fixed runtime settings for AgentRun workflow controller operations.
 *
 * The application composition selects these values. A controller task cannot choose a namespace,
 * a workload lifetime, or a model-key issuer for itself.
 */
export interface AgentRunWorkflowControllerAuthorityOptions
{
	/** Names the namespace that contains personal AgentRun Jobs. */
	readonly personalRuntimeNamespace: string;
	/** Names the namespace that contains managed AgentRun Jobs. */
	readonly managedRuntimeNamespace: string;
	/** Limits how long a saved runtime assignment may remain usable. */
	readonly assignmentTtlMilliseconds: number;
	/** Limits how long a controller may wait before it releases a bound Job. */
	readonly releaseLeaseMilliseconds: number;
	/** Waits past a possible pre-assignment Job create before orphan cleanup first observes absence. */
	readonly orphanObservationMarginMilliseconds: number;
	/** Mints the transient model key after the database transaction has committed. */
	readonly issueAttemptModelKey: AttemptModelKeyIssuerWithRevocation;
}

/**
 * Defines the database-only operations that one AgentRun controller transaction may perform.
 *
 * {@link PrismaAgentRunWorkflowControllerUnitOfWork} calls this repository. It reads the stable
 * model-key request before minting after commit, so no provider call can keep a database lock open.
 */
export interface AgentRunWorkflowControllerPersistenceRepository
{
	/** Reloads current task-bound facts before a handler creates or adopts its suspended Job. */
	loadForTask(input: AgentRunTaskInput, task: IWorkflowTaskReceipt): Promise<AgentRunWorkflowControllerRecord | null>;
	/** Returns the replay-stable request that the unit of work passes to the model-key issuer after commit. */
	loadAttemptKeyMintRequest(input: AgentRunTaskInput, task: IWorkflowTaskReceipt): Promise<AttemptModelKeyMintRequest | null>;
	/** Persists the non-secret digest of a fresh key only while this task receipt remains current. */
	recordAttemptKeyDigest(input: AgentRunTaskInput, task: IWorkflowTaskReceipt, keyDigest: string): Promise<boolean>;
	/** Confirms that this task's current digest and canonical key alias match a revocation request. */
	verifyAttemptKeyDigest(input: AgentRunTaskInput, task: IWorkflowTaskReceipt, keyAlias: string, keyDigest: string): Promise<boolean>;
	/** Saves a Job assignment or classifies the exact replay as idempotent or conflicting. */
	bindAssignment(input: AgentRunTaskInput, task: IWorkflowTaskReceipt, command: AgentRunWorkflowAssignmentCommand): Promise<"bound" | "idempotent" | "conflict">;
	/** Saves the first Pod identity or classifies the exact replay as idempotent or conflicting. */
	bindFirstPod(input: AgentRunTaskInput, task: IWorkflowTaskReceipt, command: AgentRunWorkflowPodCommand): Promise<"bound" | "idempotent" | "conflict">;
	/** Claims the persisted release fence before a controller unsuspends its already-bound Job. */
	claimRelease(input: AgentRunTaskInput, task: IWorkflowTaskReceipt, workloadUid: string): Promise<AgentRunWorkflowReleaseClaim | null>;
	/** Fences a direct task failure and queues exact cleanup for any created Job. */
	terminalizeFailedTask(input: AgentRunTaskInput, task: IWorkflowTaskReceipt): Promise<void>;
	/** Reads the task outcome without changing AgentRun lifecycle state. */
	observe(input: AgentRunTaskInput, task: IWorkflowTaskReceipt): Promise<AgentRunWorkflowObservation>;
}

/** Defines the receipt-fenced reads and non-secret key evidence owned by the task-read repository. */
export interface AgentRunWorkflowTaskReadPersistenceRepository
{
	/** Returns a stable mint request without calling the external model-key issuer. */
	loadAttemptKeyMintRequest(input: AgentRunTaskInput, task: IWorkflowTaskReceipt): Promise<AttemptModelKeyMintRequest | null>;
	/** Saves only the digest of a raw model key while this task remains current. */
	recordAttemptKeyDigest(input: AgentRunTaskInput, task: IWorkflowTaskReceipt, keyDigest: string): Promise<boolean>;
	/** Proves a raw key belongs to this task before the caller revokes it externally. */
	verifyAttemptKeyDigest(input: AgentRunTaskInput, task: IWorkflowTaskReceipt, keyAlias: string, keyDigest: string): Promise<boolean>;
}

/** Defines assignment and release persistence for the one Job that a workflow task may control. */
export interface AgentRunWorkflowAssignmentReleasePersistenceRepository
{
	/** Returns the server-approved record the handler uses to create or adopt a suspended Job. */
	loadForTask(input: AgentRunTaskInput, task: IWorkflowTaskReceipt): Promise<AgentRunWorkflowControllerRecord | null>;
	/** Saves a Job binding or classifies an exact replay without replacing that Job. */
	bindAssignment(input: AgentRunTaskInput, task: IWorkflowTaskReceipt, command: AgentRunWorkflowAssignmentCommand): Promise<"bound" | "idempotent" | "conflict">;
	/** Saves one first Pod identity or rejects a different Pod. */
	bindFirstPod(input: AgentRunTaskInput, task: IWorkflowTaskReceipt, command: AgentRunWorkflowPodCommand): Promise<"bound" | "idempotent" | "conflict">;
	/** Claims a short persisted release fence before Kubernetes unsuspends the saved Job. */
	claimRelease(input: AgentRunTaskInput, task: IWorkflowTaskReceipt, workloadUid: string): Promise<AgentRunWorkflowReleaseClaim | null>;
}

/** Defines terminal cleanup and outcome reads for a receipt-bound workflow task. */
export interface AgentRunWorkflowTerminalCleanupPersistenceRepository
{
	/** Records setup failure and queues cleanup for a Job this task may have created. */
	terminalizeFailedTask(input: AgentRunTaskInput, task: IWorkflowTaskReceipt): Promise<void>;
	/** Returns the current task outcome without creating a new lifecycle decision. */
	observe(input: AgentRunTaskInput, task: IWorkflowTaskReceipt): Promise<AgentRunWorkflowObservation>;
}
