import type { AgentRunId } from "./identifiers.types.js";

/**
 * Stable public vocabulary of ordered events emitted by one agent run.
 *
 * Readable values remain part of persistence and projection contracts but do not grant run authority.
 */
export enum RunEventTypes
{
	/** Run admission committed its immutable authority and input evidence. */
	RunAccepted = "run.accepted",
	/** Assigned runtime began executing the run. */
	RunStarted = "run.started",
	/** Runtime began assembling a user-visible message. */
	MessageStarted = "message.started",
	/** Runtime appended a bounded message delta. */
	MessageDelta = "message.delta",
	/** Runtime completed a user-visible message. */
	MessageCompleted = "message.completed",
	/** Runtime requested one governed tool action. */
	ToolRequested = "tool.requested",
	/** Tool action paused pending an explicit approval decision. */
	ToolApprovalRequired = "tool.approval_required",
	/** Governed tool execution started. */
	ToolStarted = "tool.started",
	/** Governed tool execution reported bounded progress. */
	ToolProgress = "tool.progress",
	/** Governed tool execution completed. */
	ToolCompleted = "tool.completed",
	/** Governed tool execution failed without exposing provider or credential details. */
	ToolFailed = "tool.failed",
	/** Runtime reported a display-safe nonterminal problem while the run remained active. */
	RunError = "run.error",
	/** Runtime began one versioned governed A2UI rendering surface. */
	A2uiRenderingBegun = "a2ui.rendering.begun",
	/** Runtime supplied an ordered versioned update to a governed A2UI surface. */
	A2uiSurfaceUpdated = "a2ui.surface.updated",
	/** Runtime supplied an ordered versioned update to governed A2UI data. */
	A2uiDataModelUpdated = "a2ui.data_model.updated",
	/** Runtime began compacting the run's conversation context. */
	ContextCompactionStarted = "context.compaction_started",
	/** Runtime completed context compaction. */
	ContextCompactionCompleted = "context.compaction_completed",
	/** Runtime reported bounded usage for budget accounting. */
	RunUsage = "run.usage",
	/** Run completed successfully. */
	RunCompleted = "run.completed",
	/** Run failed terminally. */
	RunFailed = "run.failed",
	/** Run reached its terminal cancelled state. */
	RunCancelled = "run.cancelled",
}

/** String form of the canonical run-event enum accepted by existing event producers. */
export type RunEventType = `${RunEventTypes}`;

/** Ordered immutable event emitted by one run. */
export interface RunEvent
{
	/** Run that owns the event stream. */
	readonly runId: AgentRunId;
	/** One-based contiguous sequence within the run. */
	readonly sequence: number;
	/** Stable public event classification. */
	readonly type: RunEventType;
	/** Immutable event payload with no runtime-SDK types. */
	readonly payload: Readonly<Record<string, unknown>>;
	/** ISO-8601 instant at which the event was persisted. */
	readonly occurredAt: string;
}
