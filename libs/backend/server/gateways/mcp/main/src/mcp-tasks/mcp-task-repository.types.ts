import type { IWorkflowTaskReceipt } from "@opencrane/backend/server/infra/workflows/contract";
import type { JsonValue } from "@opencrane/util";

import type { McpTaskInputRequest, McpTaskInputResponse, McpTaskRecord } from "./mcp-task.types";

/**
 * Rolls back MCP task cancellation when any stored fence changes during its transaction.
 * `cancelMcpTask` maps this sentinel to `TooLate` and skips workflow cancellation, keeping the
 * database rows and saved workflow on the same outcome.
 */
export class _McpTaskCancellationConflictError extends Error
{
	/** Builds the sentinel caught by `cancelMcpTask` after the transaction rolls back. */
	constructor()
	{
		super("MCP task cancellation lost its database fence");
		this.name = "McpTaskCancellationConflictError";
	}
}

/** Immutable fields written before task workflow admission. */
export interface McpTaskSubmissionRecord
{
	/** Authenticated silo owner. */
	readonly siloId: string;
	/** Authenticated Principal owner. */
	readonly principalId: string;
	/** Digest of the caller's idempotency identity. */
	readonly requestKeyDigest: string;
	/** Digest of every immutable call field. */
	readonly callDigest: string;
	/** Selected immutable server revision. */
	readonly serverRevisionId: string;
	/** Selected exact tool revision. */
	readonly toolRevisionId: string;
	/** Initial tool arguments. */
	readonly arguments: JsonValue;
	/** Optional response request saved before admission. */
	readonly inputRequest: McpTaskInputRequest | null;
}

/** Result of creating or replaying one task submission. */
export interface McpTaskCreateResult
{
	/** Whether this transaction created the task. */
	readonly created: boolean;
	/** Durable task selected by the request identity. */
	readonly task: McpTaskRecord;
}

/** Engine facts bound once after transaction-bound admission. */
export interface McpTaskWorkflowBinding
{
	/** Engine task identifier. */
	readonly taskId: string;
	/** Registered task name. */
	readonly taskName: string;
	/** Domain-derived idempotency key. */
	readonly taskKey: string;
}

/** Transaction-scoped persistence for the public MCP task lifecycle. */
export interface McpTaskRepository
{
	/** Create a task only for an installed, Published, Active, Ready MCP 2026-07-28 tool. */
	createOrFind(submission: McpTaskSubmissionRecord): Promise<McpTaskCreateResult | null>;
	/** Bind the workflow receipt once without replacing an earlier binding. */
	ensureWorkflow(siloId: string, taskId: string, binding: McpTaskWorkflowBinding): Promise<McpTaskRecord | null>;
	/** Find one task only for its authenticated owner. */
	find(siloId: string, principalId: string, taskId: string): Promise<McpTaskRecord | null>;
	/** Load the exact task selected by saved workflow input. */
	load(siloId: string, taskId: string, callDigest: string): Promise<McpTaskRecord | null>;
	/** Persist the waiting state unless input or a terminal state already won. */
	recordInputRequired(siloId: string, taskId: string, callDigest: string): Promise<McpTaskRecord | null>;
	/** Save one matching caller response idempotently. */
	recordInput(siloId: string, principalId: string, taskId: string, response: McpTaskInputResponse): Promise<McpTaskRecord | null>;
	/** Create the mutually exclusive task-owned ToolInvocation and move the task to queued. */
	admitAuthorizedToolInvocation(siloId: string, taskId: string, callDigest: string): Promise<McpTaskRecord | null>;
	/** Save one bounded pre-dispatch terminal failure idempotently. */
	recordFailure(siloId: string, taskId: string, callDigest: string, failureCode: string): Promise<McpTaskRecord | null>;
	/** Cancel before provider dispatch and close any pending MCP execution. */
	cancel(siloId: string, principalId: string, taskId: string): Promise<"cancelled" | "not_available" | "too_late">;
}
