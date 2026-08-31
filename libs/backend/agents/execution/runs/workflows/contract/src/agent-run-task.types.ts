import { WorkflowTaskRetryBackoffKinds } from "@opencrane/backend/server/infra/workflows/contract";
import type { IWorkflowTaskDeclaration } from "@opencrane/backend/server/infra/workflows/contract";

/** Names the planned remote task for one AgentRun attempt. */
export enum AgentRunTaskNames
{
	/** Identifies the future controller-owned lifecycle for one immutable AgentRun attempt. */
	Execute = "agent-runs.execute/v1",
}

/** Names the terminal state a future controller handler will report for an attempt. */
export enum AgentRunTaskTerminalStates
{
	/** The attempt completed successfully. */
	Completed = "completed",
	/** The attempt failed. */
	Failed = "failed",
	/** The attempt was cancelled. */
	Cancelled = "cancelled",
}

/** Identifies one future saved AgentRun attempt without exposing its other runtime details. */
export interface AgentRunTaskInput
{
	/** Silo that owns the future task and referenced run. */
	readonly siloId: string;
	/** Stable product record whose current attempt a handler will reload. */
	readonly runId: string;
	/** Positive attempt number that prevents the task from acting on a later retry. */
	readonly attempt: number;
}

/** Describes the terminal result for the exact task input attempt. */
export interface AgentRunTaskResult
{
	/** Run that the handler reloaded and completed. */
	readonly runId: string;
	/** Attempt completed without advancing the logical run. */
	readonly attempt: number;
	/** Terminal state that tells the workflow that no further handler work is owed. */
	readonly terminalState: AgentRunTaskTerminalStates;
}

/** Defines the remote AgentRun task that later server and controller wiring will share. */
export const AgentRunTaskDeclaration = {
	taskName: AgentRunTaskNames.Execute,
	retryPolicy: { maximumAttempts: 3, backoff: { kind: WorkflowTaskRetryBackoffKinds.Exponential, initialDelaySeconds: 30, multiplier: 2, maximumDelaySeconds: 300 } },
} as const satisfies IWorkflowTaskDeclaration;
