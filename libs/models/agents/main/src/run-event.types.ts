import type { AgentRunId } from "./identifiers.types.js";

/**
 * Every kind of event one agent run can emit, in the order a reader would meet them.
 *
 * The string values are stored in the database and read by clients, so they cannot be renamed without
 * a migration. Holding one of these values grants nothing on its own: an event says what happened, it
 * does not authorise anything.
 *
 * Each member below records the payload it carries. Where a member says the runtime cannot report it,
 * the server or the tool worker writes it instead, and an attempt by the runtime is refused.
 * @see _RuntimeEventPayloadIsSafe in libs/backend/agents/execution/runs, which is where these payload
 * rules are enforced and refused.
 */
export enum RunEventTypes
{
	/** The run was admitted and its inputs were frozen. The runtime cannot report this one. */
	RunAccepted = "run.accepted",
	/** The runtime assigned to this run began executing it. Payload: `promptCompilerVersion`. */
	RunStarted = "run.started",
	/** The runtime picked up again after the control plane paused it. Payload: `inputGeneration`, a counter. */
	RunResumed = "run.resumed",
	/** The runtime began building a message for the user. Payload: `messageId`, and `role`, which must be `assistant`. */
	MessageStarted = "message.started",
	/** The runtime added the next piece of a message it is still writing. Payload: `messageId` and `delta`, the new text. */
	MessageDelta = "message.delta",
	/** The runtime finished a message for the user. Payload: `messageId`. */
	MessageCompleted = "message.completed",
	/** The runtime asked to call a tool. Asking is not permission to run it. Payload: `toolCallId` and `toolCallName`. */
	ToolRequested = "tool.requested",
	/** A tool call is waiting for someone to approve or reject it. The runtime cannot report this one. */
	ToolApprovalRequired = "tool.approval_required",
	/** A tool call started. Only the tool worker may report this, because only it knows the call really began. */
	ToolStarted = "tool.started",
	/** A running tool call reported progress. The runtime cannot report this one. */
	ToolProgress = "tool.progress",
	/** A tool call finished. Only the tool worker may report this, because only it knows the provider's result. */
	ToolCompleted = "tool.completed",
	/** A tool call failed, with no provider message or credential in the payload. Only the tool worker may report this. */
	ToolFailed = "tool.failed",
	/** A tool call's result could not be established, so someone must decide what happened. The runtime cannot report this one. */
	ToolRecoveryRequired = "tool.recovery_required",
	/** Something went wrong but the run carried on. Payload: `reason` from a closed list, and an optional `errorType`. */
	RunError = "run.error",
	/** The runtime started drawing a generated UI. Payload: `a2ui`, holding the envelope. */
	A2uiRenderingBegun = "a2ui.rendering.begun",
	/** The runtime changed part of a generated UI. Payload: `a2ui`, holding the envelope. */
	A2uiSurfaceUpdated = "a2ui.surface.updated",
	/** The runtime changed the data behind a generated UI. Payload: `a2ui`, holding the envelope. */
	A2uiDataModelUpdated = "a2ui.data_model.updated",
	/** The runtime began shortening the conversation to fit the context window. The runtime cannot report this one. */
	ContextCompactionStarted = "context.compaction_started",
	/** The runtime finished shortening the conversation. The runtime cannot report this one. */
	ContextCompactionCompleted = "context.compaction_completed",
	/** Token counts for billing and budget limits. Payload: `inputTokens` and `outputTokens`. */
	RunUsage = "run.usage",
	/** The run finished successfully. Payload: empty, and any key at all is refused. */
	RunCompleted = "run.completed",
	/** The run failed and will not continue. Payload: `reason` from a closed list, and an optional `errorType`. */
	RunFailed = "run.failed",
	/** The run was cancelled. Cancelling is the server's decision, so the runtime cannot report this one. */
	RunCancelled = "run.cancelled",
}

/** The same event types as a plain string union, for producers that hold the value rather than the enum. */
export type RunEventType = `${RunEventTypes}`;

/** One event in a run's history. Events are never edited or reordered once written. */
export interface RunEvent
{
	/** Run whose history this event belongs to. */
	readonly runId: AgentRunId;
	/** Position in this run's history, starting at 1 with no gaps. */
	readonly sequence: number;
	/** What happened. */
	readonly type: RunEventType;
	/** The event's data, holding only plain JSON so no runtime SDK type can leak into storage. */
	readonly payload: Readonly<Record<string, unknown>>;
	/** ISO-8601 instant the event was written. */
	readonly occurredAt: string;
}
