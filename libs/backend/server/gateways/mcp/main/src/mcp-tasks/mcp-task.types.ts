import type { IWorkflowEngine, IWorkflowTaskReceipt, IWorkflowTransaction } from "@opencrane/backend/server/infra/workflows/contract";

import type { McpOperatorUnitOfWork } from "../core/mcp-operator-repository.types";

/**
 * Describes the saved lifecycle of an asynchronous MCP tool call.
 *
 * These strings are mapped from `McpTaskState` in `mcp_tasks` and are returned in a task record,
 * so changing one needs both a database migration and a client contract change. The workflow and
 * input submission paths branch on them; an unknown database value makes the repository reject the
 * record rather than inventing a client-visible state.
 */
export enum McpTaskStates
{
	/** The call is saved and the workflow has not yet asked the client for input. */
	Working = "working",
	/** The workflow is waiting for the request in `inputRequest`; the client may submit its answer. */
	InputRequired = "input_required",
	/** The workflow saved `result`; this is terminal and the client reads the result instead of submitting input. */
	Completed = "completed",
	/** The caller cancelled the task before it saved a result; this is terminal. */
	Cancelled = "cancelled",
	/** The workflow ended with `failureCode`; this is terminal. */
	Failed = "failed",
}

/**
 * Names the workflow handlers registered for MCP task records.
 *
 * `taskName` is saved with an admitted task and checked on replay, so renaming a member would make
 * a retry appear to be bound to a different workflow.
 */
export enum McpTaskTaskNames
{
	/** The handler moves a call to `InputRequired`, waits for input, and records the final result. */
	Call = "mcp-task.call",
}

/** Names the engine events that the MCP task workflow accepts. */
export enum McpTaskEvents
{
	/** Carries an accepted response after the repository has saved it against the task request. */
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

/**
 * Tells a task-input caller whether the response reached the waiting workflow.
 *
 * The value is returned by `submitMcpTaskInput`, not stored in the database. Callers may treat
 * `Accepted` as a successful handoff, while `NotAvailable` must reveal neither task existence nor
 * ownership and `Conflict` tells the caller that its request or value differs from saved input.
 */
export enum McpTaskInputSubmissionOutcomes
{
	/** The repository saved the response and the workflow received its event. */
	Accepted = "accepted",
	/** The task is absent, belongs to another caller, or cannot accept input now. */
	NotAvailable = "not_available",
	/** The request identifier or response value differs from the saved input. */
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

/**
 * Admits and wakes the workflow bound to a saved MCP task.
 *
 * The submission flow admits the task in the product transaction, then saves the engine receipt so
 * a replay cannot bind different workflow facts. Input is persisted before `deliverInput` emits its
 * event, allowing a replayed workflow to use the saved answer.
 */
export interface McpTaskWorkflow
{
	/** Saves or returns the workflow task through the transaction that created the product record. */
	admit(transaction: IWorkflowTransaction, input: McpTaskWorkflowInput): Promise<McpTaskAdmission>;
	/** Emits the event for a response that the repository has already accepted. */
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
