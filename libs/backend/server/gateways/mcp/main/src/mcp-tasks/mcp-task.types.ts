import type { IWorkflowEngine, IWorkflowTaskReceipt, IWorkflowTransaction } from "@opencrane/backend/server/infra/workflows/contract";
import type { JsonValue } from "@opencrane/util";

import type { McpOperatorUnitOfWork } from "../core/mcp-operator-repository.types";

/** Public lifecycle values saved for one asynchronous OCI-backed MCP tool call. */
export enum McpTaskStates
{
	/** The task is saved and its workflow is preparing durable execution. */
	Working = "working",
	/** The caller must answer the saved request before execution can continue. */
	InputRequired = "input_required",
	/** ToolInvocation and MCP executor work are durably admitted. */
	Queued = "queued",
	/** The isolated companion holds the provider-effect claim. */
	Running = "running",
	/** The checked MCP result is saved. */
	Completed = "completed",
	/** Cancellation won before provider dispatch. */
	Cancelled = "cancelled",
	/** A definite terminal failure is saved. */
	Failed = "failed",
	/** The provider outcome is uncertain and needs operator recovery. */
	RecoveryRequired = "recovery_required",
}

/** Stable handler name persisted with every public MCP task receipt. */
export enum McpTaskTaskNames
{
	/** Admits one exact ToolInvocation and waits for its durable terminal projection. */
	Call = "mcp-task.call",
}

/** Engine events accepted by the public task workflow. */
export enum McpTaskEvents
{
	/** Wakes the exact task after its caller-owned input response commits. */
	InputSubmitted = "mcp-task.input-submitted",
}

/** Bounded caller request whose response fills one top-level tool argument. */
export interface McpTaskInputRequest
{
	/** Stable request id repeated by the response. */
	readonly requestId: string;
	/** Plain-language question shown to the caller. */
	readonly message: string;
	/** Top-level JSON property filled from the accepted response. */
	readonly argumentName: string;
}

/** One caller response saved before the workflow receives its wake-up event. */
export interface McpTaskInputResponse
{
	/** Identifies the saved request this response answers. */
	readonly requestId: string;
	/** JSON value inserted into the request's exact top-level argument property. */
	readonly value: JsonValue;
}

/** Immutable caller command for one exact discovered MCP tool. */
export interface McpTaskSubmissionCommand
{
	/** Caller key that makes a repeated HTTP request select the same task. */
	readonly idempotencyKey: string;
	/** Immutable Ready MCP server revision selected by the caller. */
	readonly serverRevisionId: string;
	/** Exact discovered tool revision on that server revision. */
	readonly toolRevisionId: string;
	/** Canonical tool arguments, optionally completed by one later input response. */
	readonly arguments: JsonValue;
	/** Optional saved request that must be answered before provider dispatch. */
	readonly inputRequest?: McpTaskInputRequest;
}

/** Authenticated owner derived from the browser request rather than its body. */
export interface McpTaskCaller
{
	/** Silo selected by the authenticated host and session. */
	readonly siloId: string;
	/** Durable local Principal allowed to read and change the task. */
	readonly principalId: string;
}

/** Caller-visible durable task record. */
export interface McpTaskRecord
{
	/** Stable public task identifier. */
	readonly id: string;
	/** Owning silo retained only for trusted workflow and repository calls. */
	readonly siloId: string;
	/** Owning Principal retained only for trusted authorization checks. */
	readonly principalId: string;
	/** Digest binding every immutable call field. */
	readonly callDigest: string;
	/** Immutable Ready server revision selected at submission. */
	readonly serverRevisionId: string;
	/** Exact tool revision selected at submission. */
	readonly toolRevisionId: string;
	/** Exact tool name frozen from discovery. */
	readonly toolName: string;
	/** Only MCP protocol revision accepted by this task. */
	readonly protocolVersion: string;
	/** Current public lifecycle state. */
	readonly state: McpTaskStates;
	/** Request still awaiting input, otherwise null. */
	readonly inputRequest: McpTaskInputRequest | null;
	/** Accepted response, otherwise null. */
	readonly inputResponse: McpTaskInputResponse | null;
	/** Checked terminal MCP result, otherwise null. */
	readonly result: JsonValue | null;
	/** Stable terminal failure category, otherwise null. */
	readonly failureCode: string | null;
	/** Authorization-owned ToolInvocation row after durable admission. */
	readonly toolInvocationRowId: string | null;
	/** Absurd task receipt after transaction-bound admission. */
	readonly workflowTask: IWorkflowTaskReceipt | null;
}

/** Result of transaction-bound Absurd admission. */
export interface McpTaskAdmission
{
	/** Engine receipt saved with the product task. */
	readonly receipt: IWorkflowTaskReceipt;
	/** Opaque stable task key used for idempotent admission. */
	readonly taskKey: string;
}

/** Minimal task identity saved in Absurd input. */
export interface McpTaskWorkflowInput
{
	/** Silo owning the product task. */
	readonly siloId: string;
	/** Product task selected by the workflow. */
	readonly mcpTaskId: string;
	/** Digest rejecting replay against changed immutable call fields. */
	readonly callDigest: string;
}

/** Terminal result returned by the Absurd handler after observing product state. */
export interface McpTaskWorkflowResult
{
	/** Product task completed by this handler. */
	readonly mcpTaskId: string;
	/** Final caller-visible state. */
	readonly state: McpTaskStates.Completed | McpTaskStates.Cancelled | McpTaskStates.Failed | McpTaskStates.RecoveryRequired;
}

/** Product-facing workflow operations for public MCP tasks. */
export interface McpTaskWorkflow
{
	/** Admit or return the same Absurd task in the caller's database transaction. */
	admit(transaction: IWorkflowTransaction, input: McpTaskWorkflowInput): Promise<McpTaskAdmission>;
	/** Wake the task only after its matching response has committed. */
	deliverInput(task: IWorkflowTaskReceipt, input: McpTaskWorkflowInput, response: McpTaskInputResponse): Promise<void>;
	/** Cancel an incomplete Absurd handler after product cancellation wins. */
	cancel(task: IWorkflowTaskReceipt): Promise<void>;
}

/** Dependencies used by the public MCP task workflow. */
export interface McpTaskWorkflowOptions
{
	/** Engine-neutral Absurd contract owned by app composition. */
	readonly execution: IWorkflowEngine;
	/** Product transaction owner for task state and ToolInvocation admission. */
	readonly unitOfWork: McpOperatorUnitOfWork;
	/** Existing OCI MCP runtime authority that admits work and closes exhausted attempts. */
	readonly runtime: McpTaskWorkflowRuntime;
	/** Durable wait between runtime status reads. */
	readonly statusPollMilliseconds: number;
}

/**
 * Lets the public MCP task workflow admit provider work and close its linked rows after retries end.
 *
 * Normal attempts call {@link admitInvocation}. The final retryable attempt calls
 * {@link recordWorkflowExhaustion}; a returned task result is safe to expose, while `null` means
 * the saved rows no longer match the observed fences and the workflow must not invent a result.
 *
 * Called by: {@link __CreateMcpTaskWorkflow}.
 */
export interface McpTaskWorkflowRuntime
{
	/** Admit the authorization-owned invocation; `not_ready` and `not_mcp` make the task fail without provider dispatch. */
	admitInvocation(toolInvocationRowId: string): Promise<"admitted" | "idempotent" | "not_ready" | "not_mcp">;
	/** Return the saved terminal task after closing linked work, or `null` when a changed fence prevents that transition. */
	recordWorkflowExhaustion(input: McpTaskWorkflowInput): Promise<McpTaskWorkflowResult | null>;
}

/**
 * Closes an exhausted MCP task, its ToolInvocation, and its runtime execution in one database transaction.
 *
 * Work that never reached provider dispatch becomes `Failed`. Work with a saved dispatch claim
 * becomes `RecoveryRequired` because the provider outcome is unknown. An already terminal task is
 * returned unchanged, and `null` tells the transaction owner that a row or fence no longer matches.
 *
 * Implemented by: {@link PrismaMcpTaskWorkflowExhaustionRepository}.
 * Called by: {@link PrismaMcpRuntimeUnitOfWork.recordWorkflowExhaustion}.
 */
export interface McpTaskWorkflowExhaustionRepository
{
	/** Return a saved terminal result after every linked write succeeds, or `null` without claiming success. */
	record(input: McpTaskWorkflowInput): Promise<McpTaskWorkflowResult | null>;
}

/** Stable outcomes returned when a caller submits task input. */
export enum McpTaskInputSubmissionOutcomes
{
	/** The response committed and its workflow was notified. */
	Accepted = "accepted",
	/** No caller-visible waiting task exists. */
	NotAvailable = "not_available",
	/** Request identity or replayed value conflicts. */
	Conflict = "conflict",
}

/** Result of one input response submission. */
export interface McpTaskInputSubmissionResult
{
	/** Stable submission outcome. */
	readonly outcome: McpTaskInputSubmissionOutcomes;
	/** Updated task for an accepted response. */
	readonly task?: McpTaskRecord;
}

/** Stable cancellation outcomes returned to the public route. */
export enum McpTaskCancellationOutcomes
{
	/** Cancellation terminalized the task before provider dispatch. */
	Cancelled = "cancelled",
	/** The task is absent, belongs to another caller, or is already terminal. */
	NotAvailable = "not_available",
	/** Provider dispatch already started, so cancellation cannot claim success. */
	TooLate = "too_late",
}

/** Result of one caller cancellation attempt. */
export interface McpTaskCancellationResult
{
	/** Stable cancellation decision. */
	readonly outcome: McpTaskCancellationOutcomes;
	/** Updated cancelled task when cancellation won. */
	readonly task?: McpTaskRecord;
}
