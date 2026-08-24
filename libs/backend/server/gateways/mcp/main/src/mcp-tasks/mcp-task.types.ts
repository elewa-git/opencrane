import type { IWorkflowEngine, IWorkflowTaskReceipt, IWorkflowTransaction } from "@opencrane/backend/server/infra/workflows/contract";

import type { McpOperatorUnitOfWork } from "../core/mcp-operator-repository.types";

/** Client-visible states for one asynchronous MCP tool call. */
export enum McpTaskStates
{
	/** The call has been accepted and its workflow still has work to do. */
	Working = "working",
	/** The workflow cannot continue until its caller supplies the requested value. */
	InputRequired = "input_required",
	/** The workflow stored its final result. */
	Completed = "completed",
	/** The caller cancelled the task before it stored a result. */
	Cancelled = "cancelled",
	/** The workflow ended with an MCP-visible failure. */
	Failed = "failed",
}

/** Stable workflow task names registered for asynchronous MCP tool calls. */
export enum McpTaskTaskNames
{
	/** Waits for a client response, then stores the bounded result for one MCP tool call. */
	Call = "mcp-task.call",
}

/** Event names delivered to an MCP task workflow. */
export enum McpTaskEvents
{
	/** Carries one accepted response for a saved input request. */
	InputSubmitted = "mcp-task.input-submitted",
}

/** A bounded question that an MCP task presents to the client. */
export interface McpTaskInputRequest
{
	/** Stable request identifier that a later response must repeat. */
	readonly requestId: string;
	/** Plain-language text that tells the client which value the task needs. */
	readonly message: string;
}

/** One client answer accepted for a saved MCP task input request. */
export interface McpTaskInputResponse
{
	/** Identifies the saved request this answer satisfies. */
	readonly requestId: string;
	/** Carries the bounded text value supplied by the client. */
	readonly value: string;
}

/** Immutable task facts submitted before the workflow is admitted. */
export interface McpTaskSubmissionCommand
{
	/** Caller-owned stable key that makes a repeated tool call select the same task. */
	readonly idempotencyKey: string;
	/** MCP tool name selected by the client. */
	readonly toolName: string;
	/** Tool arguments bound into the immutable call digest without retaining their contents. */
	readonly arguments: unknown;
	/** The one bounded value this initial lifecycle task will wait for. */
	readonly inputRequest: McpTaskInputRequest;
}

/** Identifies the authenticated user allowed to read or update one MCP task. */
export interface McpTaskCaller
{
	/** Silo derived from the authenticated request boundary. */
	readonly siloId: string;
	/** Principal derived from the authenticated request boundary. */
	readonly principalId: string;
}

/** Client-visible product record for one asynchronous MCP tool call. */
export interface McpTaskRecord
{
	/** Stable task identifier returned by `tools/call` and accepted by task methods. */
	readonly id: string;
	/** Silo that owns this task. */
	readonly siloId: string;
	/** Principal allowed to read and update this task. */
	readonly principalId: string;
	/** Opaque digest that binds the task workflow to its immutable client call. */
	readonly callDigest: string;
	/** Name of the tool selected for this task. */
	readonly toolName: string;
	/** Client-visible lifecycle state. */
	readonly state: McpTaskStates;
	/** Requested input while the task is waiting, otherwise `null`. */
	readonly inputRequest: McpTaskInputRequest | null;
	/** Accepted input when the client has responded, otherwise `null`. */
	readonly inputResponse: McpTaskInputResponse | null;
	/** Bounded final result text when the task has completed. */
	readonly result: string | null;
	/** Stable failure reason when the task has failed. */
	readonly failureCode: string | null;
	/** Engine receipt bound to this product task after admission. */
	readonly workflowTask: IWorkflowTaskReceipt | null;
}

/** Receipt returned after a client call is saved and its workflow is admitted. */
export interface McpTaskAdmission
{
	/** Engine receipt for the task admitted with the product write. */
	readonly receipt: IWorkflowTaskReceipt;
	/** Engine task key used only to make admission retry-safe. */
	readonly taskKey: string;
}

/** Result of accepting a client input response. */
export enum McpTaskInputSubmissionOutcomes
{
	/** The response was saved and delivered to the waiting workflow. */
	Accepted = "accepted",
	/** The task is absent, belongs to another caller, or is not waiting for input. */
	NotAvailable = "not_available",
	/** The response conflicts with the saved request or a previous answer. */
	Conflict = "conflict",
}

/** Result returned after one client supplies input for an MCP task. */
export interface McpTaskInputSubmissionResult
{
	/** Describes whether the response was accepted, unavailable, or conflicted. */
	readonly outcome: McpTaskInputSubmissionOutcomes;
	/** Updated task when the response was accepted. */
	readonly task?: McpTaskRecord;
}

/** Task input held by Absurd without exposing client request contents. */
export interface McpTaskWorkflowInput
{
	/** Silo that owns the product task. */
	readonly siloId: string;
	/** Product task selected when the workflow was admitted. */
	readonly mcpTaskId: string;
	/** Immutable call digest that rejects a task bound to replaced input. */
	readonly callDigest: string;
}

/** Transaction-bound API that admits the saved MCP task workflow. */
export interface McpTaskWorkflow
{
	/** Save or return the workflow task through the same database transaction as the product record. */
	admit(transaction: IWorkflowTransaction, input: McpTaskWorkflowInput): Promise<McpTaskAdmission>;
	/** Deliver one accepted client response to the workflow waiting for that task. */
	deliverInput(task: IWorkflowTaskReceipt, input: McpTaskWorkflowInput, response: McpTaskInputResponse): Promise<void>;
}

/** Dependencies used to register the durable MCP task lifecycle. */
export interface McpTaskWorkflowOptions
{
	/** Engine-neutral workflow engine supplied by application composition. */
	readonly execution: IWorkflowEngine;
	/** MCP database transaction owner used to load and update product state. */
	readonly unitOfWork: McpOperatorUnitOfWork;
}
