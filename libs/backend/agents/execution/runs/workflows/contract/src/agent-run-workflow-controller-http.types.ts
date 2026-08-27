import type { AgentRunWorkflowAssignmentCommand, AgentRunWorkflowAttemptKey, AgentRunWorkflowPodCommand } from "./agent-run-workflow-controller.types";
import type { AgentRunTaskInput } from "./agent-run-task.types";
import type { IWorkflowTaskReceipt } from "@opencrane/backend/server/infra/workflows/contract";

/** Carries the saved task identity and run attempt for one controller request. */
export interface AgentRunWorkflowTaskRequest
{
	/** Identifies the exact AgentRun attempt the controller is acting for. */
	readonly input: AgentRunTaskInput;
	/** Identifies the durable workflow task admitted with that attempt. */
	readonly task: IWorkflowTaskReceipt;
}

/** Carries one immutable Job-assignment report from the controller. */
export interface AgentRunWorkflowAssignmentRequest extends AgentRunWorkflowTaskRequest
{
	/** Supplies the Job UID, selected profile, and ServiceAccount for the fenced binding. */
	readonly command: AgentRunWorkflowAssignmentCommand;
}

/** Carries one first-Pod report from the controller. */
export interface AgentRunWorkflowPodRequest extends AgentRunWorkflowTaskRequest
{
	/** Supplies the exact Job and Pod identities observed by the controller. */
	readonly command: AgentRunWorkflowPodCommand;
}

/** Carries one task-bound raw key that a controller must revoke without persistence. */
export interface AgentRunWorkflowAttemptKeyRevocationRequest extends AgentRunWorkflowTaskRequest
{
	/** Supplies the raw transient key and its server-selected alias. */
	readonly attemptKey: AgentRunWorkflowAttemptKey;
}

/** Carries the Job UID for a server-fenced release claim. */
export interface AgentRunWorkflowReleaseClaimRequest extends AgentRunWorkflowTaskRequest
{
	/** Identifies the Job already bound to this exact run attempt. */
	readonly workloadUid: string;
}
