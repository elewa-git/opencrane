import type { IWorkflowTaskReceipt } from "@opencrane/backend/server/infra/workflows/contract";

import type { McpTaskInputRequest, McpTaskInputResponse, McpTaskRecord, McpTaskStates } from "./mcp-task.types";

/** Fields written before an MCP task workflow is admitted. */
export interface McpTaskSubmissionRecord
{
	/** Silo that owns the client call. */
	readonly siloId: string;
	/** Authenticated principal that may later read and update the task. */
	readonly principalId: string;
	/** Digest of the caller's stable request key. */
	readonly requestKeyDigest: string;
	/** Digest of every immutable client call field. */
	readonly callDigest: string;
	/** MCP tool name selected by the caller. */
	readonly toolName: string;
	/** Bounded question that the workflow will present to the client. */
	readonly inputRequest: McpTaskInputRequest;
}

/** Result of creating one MCP task or selecting a retry of the same call. */
export interface McpTaskCreateResult
{
	/** True only when this transaction created the product task. */
	readonly created: boolean;
	/** Saved task selected by the request key. */
	readonly task: McpTaskRecord;
}

/** Task facts saved after workflow admission. */
export interface McpTaskWorkflowBinding
{
	/** Engine-owned task identifier. */
	readonly taskId: string;
	/** Registered workflow task name. */
	readonly taskName: string;
	/** Domain-derived task key that makes admission retry-safe. */
	readonly taskKey: string;
}

/**
 * Provides the product writes and reads for one MCP task transaction.
 *
 * Implementations keep a retry tied to the same immutable call, scope client reads to the caller's
 * silo and principal, and preserve an accepted input before the workflow is notified. `null` always
 * means the requested task is unavailable or conflicts with saved facts, so the caller must not
 * infer another principal's task state from it.
 */
export interface McpTaskRepository
{
	/** Creates a task or returns its retry when every immutable call fact still matches. */
	createOrFind(submission: McpTaskSubmissionRecord): Promise<McpTaskCreateResult | null>;
	/** Binds the admitted engine task, or rejects a retry that names different workflow facts. */
	ensureWorkflow(siloId: string, taskId: string, binding: McpTaskWorkflowBinding): Promise<McpTaskRecord | null>;
	/** Finds a task for its authenticated owner without exposing another caller's record. */
	find(siloId: string, principalId: string, taskId: string): Promise<McpTaskRecord | null>;
	/** Loads the task whose saved call digest still matches the replayed workflow input. */
	load(siloId: string, taskId: string, callDigest: string): Promise<McpTaskRecord | null>;
	/** Moves a working task to `InputRequired` without replacing a saved answer or final state. */
	recordInputRequired(siloId: string, taskId: string, callDigest: string): Promise<McpTaskRecord | null>;
	/** Saves an answer when it matches the task request and leaves a repeated matching answer unchanged. */
	recordInput(siloId: string, principalId: string, taskId: string, response: McpTaskInputResponse): Promise<McpTaskRecord | null>;
	/** Saves the final result once after the workflow receives the accepted input event. */
	recordCompleted(siloId: string, taskId: string, callDigest: string, result: string): Promise<McpTaskRecord | null>;
}
