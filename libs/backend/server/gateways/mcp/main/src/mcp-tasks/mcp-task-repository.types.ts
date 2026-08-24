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

/** Transaction-scoped persistence operations for the MCP task lifecycle. */
export interface McpTaskRepository
{
	/** Create one task or return the same task when all immutable call facts match. */
	createOrFind(submission: McpTaskSubmissionRecord): Promise<McpTaskCreateResult | null>;
	/** Bind the admitted workflow task and reject a retry with different task facts. */
	ensureWorkflow(siloId: string, taskId: string, binding: McpTaskWorkflowBinding): Promise<McpTaskRecord | null>;
	/** Find one task only inside the authenticated caller's silo and principal. */
	find(siloId: string, principalId: string, taskId: string): Promise<McpTaskRecord | null>;
	/** Load one exact task for workflow replay. */
	load(siloId: string, taskId: string, callDigest: string): Promise<McpTaskRecord | null>;
	/** Mark a working task as waiting for its saved input request. */
	recordInputRequired(siloId: string, taskId: string, callDigest: string): Promise<McpTaskRecord | null>;
	/** Save a client answer only when it satisfies the saved input request. */
	recordInput(siloId: string, principalId: string, taskId: string, response: McpTaskInputResponse): Promise<McpTaskRecord | null>;
	/** Save the bounded final result after the workflow has received the input event. */
	recordCompleted(siloId: string, taskId: string, callDigest: string, result: string): Promise<McpTaskRecord | null>;
}
