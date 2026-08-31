import type { CustomEvent, Interrupt, RunErrorEvent, RunFinishedEvent, RunStartedEvent, TextMessageContentEvent, TextMessageEndEvent, TextMessageStartEvent, ToolCallArgsEvent, ToolCallEndEvent, ToolCallResultEvent, ToolCallStartEvent } from "@ag-ui/core";
import type { BeginRenderingMessage, DataModelUpdate, SurfaceUpdateMessage } from "@a2ui/web_core/v0_8";

import type { RunEventType } from "@opencrane/models/agents";
import type { ConversationId } from "@opencrane/models/conversations";
import type { SafeToolTechnicalDetails } from "./conversation-elicitation.types";

/**
 * Version tag for OpenCrane's AG-UI event projection.
 *
 * OpenCrane deliberately emits a small subset of the AG-UI event set, so a client
 * must not assume every upstream event type can appear. Bump this when the set of
 * emitted events or their field meanings change, so a client can refuse a stream
 * it does not understand.
 * @see https://docs.ag-ui.com
 */
export const AG_UI_PROJECTION_VERSION = "opencrane.ag-ui.v2";

/**
 * Version tag for the A2UI payload OpenCrane carries inside an AG-UI CUSTOM event.
 *
 * This is also the CUSTOM event's `name`, so a client matches on this exact string to
 * find A2UI payloads and ignores CUSTOM events with any other name.
 * @see https://a2ui.org/specification/v0.8-a2ui/
 * @see https://docs.ag-ui.com
 */
export const AG_UI_A2UI_ENVELOPE_VERSION = "opencrane.a2ui.v1";

/**
 * Version tag for the child-run update OpenCrane carries inside a parent's run stream.
 *
 * Also the CUSTOM event's `name`. The update is deliberately lossy: it reports only how
 * the child ended, never the child's own context or its siblings, so a parent-side client
 * cannot reconstruct a child conversation from it.
 * @see {@link AgUiChildRunEnvelope}
 */
export const AG_UI_CHILD_RUN_ENVELOPE_VERSION = "opencrane.child_run.v1";

/** Custom event name telling the browser to clear the open-interrupt overlay. It carries no cursor, so Last-Event-ID never advances past it. */
export const AG_UI_INTERRUPTS_CLEARED_EVENT = "opencrane.interrupts_cleared";

/** Custom event name for a failed tool call. The run may continue afterwards, so this is not a terminal event. */
export const AG_UI_TOOL_FAILURE_EVENT = "opencrane.tool_failed";

/** Custom event name for a run whose provider outcome is unknown and needs a manual recovery step. The run can still be cancelled. */
export const AG_UI_TOOL_RECOVERY_REQUIRED_EVENT = "opencrane.tool_recovery_required";

/** Versioned custom event name for the server-projected run wait collection. */
export const AG_UI_RUN_WAIT_STATE_EVENT = "opencrane.run_wait.v1";

/**
 * Display-safe reasons a conversation run has not completed yet.
 *
 * The server projection sends these values to the browser. They describe current state but grant no
 * authority to answer, approve, retry, or recover anything. Unknown values invalidate the envelope.
 */
export enum AgUiRunWaitReasons
{
	/** An outside action is still being prepared, executed, or returned; no person is necessarily needed. */
	ExternalAction = "external_action",
	/** A server-selected participant must answer ordinary or reviewed A2UI input. */
	ParticipantInput = "participant_input",
	/** Server preparation proved that a tool invocation needs an approval decision. */
	Approval = "approval",
	/** The execution user must grant one-use access to personal memory. */
	PersonalMemoryPermission = "personal_memory_permission",
	/** A provider outcome is unclear and requires a manual recovery decision. */
	RecoveryRequired = "recovery_required",
}

/**
 * Authority group that owns one subset of the projected wait collection.
 *
 * The browser applies replacement operations within one source so a reconnecting participant
 * snapshot cannot erase active runtime work or manual recovery evidence.
 */
export enum AgUiRunWaitSources
{
	/** Runtime-proposed outside actions after server admission. */
	Runtime = "runtime",
	/** Server-owned participant, approval, and personal-memory requests. */
	Participant = "participant",
	/** Server-owned manual recovery requirements. */
	Recovery = "recovery",
}

/** How one projected envelope changes the wait collection owned by its source. */
export enum AgUiRunWaitOperations
{
	/** Add or update the listed waits without changing siblings. */
	Add = "add",
	/** Remove the listed wait identifiers without changing siblings. */
	Remove = "remove",
	/** Replace every current wait from this source, including with an empty list. */
	Replace = "replace",
}

/** One display-safe wait in the source-owned collection. */
export interface AgUiRunWait
{
	/** Stable identifier used to update or remove this wait without exposing request content. */
	readonly id: string;
	/** Server-projected category the browser may display. */
	readonly reason: AgUiRunWaitReasons;
}

/** Versioned mutation of one authority-owned subset of a run's wait collection. */
export interface AgUiRunWaitStateEnvelope
{
	/** Exact custom event version. */
	readonly version: typeof AG_UI_RUN_WAIT_STATE_EVENT;
	/** Active run whose wait collection changes. */
	readonly runId: string;
	/** Authority group that owns the listed waits. */
	readonly source: AgUiRunWaitSources;
	/** Collection operation the browser applies. */
	readonly operation: AgUiRunWaitOperations;
	/** Bounded waits containing fixed categories and opaque identifiers only. */
	readonly waits: readonly AgUiRunWait[];
}

/**
 * The display states the server assigns to one A2UI surface in the browser.
 *
 * These serialized values describe display state only. They never authorize an action, infer a
 * canonical run transition, or let the browser select the next state.
 */
export enum AgUiA2uiSurfaceStates
{
	/** Ordered surface operations are still arriving. */
	Streaming = "streaming",
	/** The server says the surface is ready for the user to act on. */
	Ready = "ready",
	/** The user acted and the server has not accepted or rejected it yet; keep controls disabled. */
	ActionPending = "action_pending",
	/** The authoritative server accepted the displayed action. */
	Submitted = "submitted",
	/** The server rejected submitted values as invalid. */
	ValidationError = "validation_error",
	/** The action failed on the server; nothing was recorded as successful. */
	ActionFailed = "action_failed",
	/** The server-declared action window expired. */
	Expired = "expired",
	/** The one-use action was already consumed. */
	AlreadyUsed = "already_used",
	/** The current actor is not authorized to use the displayed action. */
	Unauthorized = "unauthorized",
	/** The surface passed validation but this client cannot render it. */
	Unsupported = "unsupported",
}

/** An A2UI surface operation that passed strict validation. */
export type AgUiA2uiOperation = { readonly beginRendering: BeginRenderingMessage } | { readonly surfaceUpdate: SurfaceUpdateMessage } | { readonly dataModelUpdate: DataModelUpdate };

/** Browser-safe A2UI payload. It carries display ids only, and never permission to act. */
export interface AgUiA2uiEnvelope
{
	readonly version: typeof AG_UI_A2UI_ENVELOPE_VERSION;
	readonly conversationId: string;
	readonly runId: string;
	readonly messageId: string;
	readonly surfaceId: string;
	readonly sequence: number;
	readonly state: AgUiA2uiSurfaceStates;
	readonly operations: readonly AgUiA2uiOperation[];
	readonly reason?: string;
	/** Server-projected displayed action binding; presentation alone never grants authority. */
	readonly actionBinding?: AgUiA2uiActionBinding;
}

/** One displayed A2UI action bound to an already-admitted elicitation request. */
export interface AgUiA2uiActionBinding
{
	/** Display-only action identifier from the reviewed surface. */
	readonly displayedActionId: string;
	/** Exact component that emitted the display intent. */
	readonly sourceComponentId: string;
	/** Existing elicitation request on the same conversation, run, and attempt. */
	readonly elicitationRequestId: string;
}

/** How a child run ended, as reported to its immediate parent run. */
export type AgUiChildRunState = "completed" | "failed" | "cancelled";

/** Child-run update sent to the parent. It deliberately leaves out the child's own context and any sibling data. */
export interface AgUiChildRunEnvelope
{
	readonly version: typeof AG_UI_CHILD_RUN_ENVELOPE_VERSION;
	readonly parentRunId: string;
	readonly childRunId: string;
	readonly attempt: number;
	readonly state: AgUiChildRunState;
	readonly terminalReason?: string;
	readonly finishedAt: string;
}

/**
 * Payload of the {@link AG_UI_TOOL_FAILURE_EVENT} CUSTOM event.
 *
 * Safe to display: it names which tool call failed and, when the server chose one, a code
 * from a fixed list. It never carries the provider's own error text. The run may continue
 * after this event, so a client must not treat it as terminal.
 */
export interface AgUiToolFailureEnvelope
{
	/** Name of the source run event. It gives the browser no permission to act or retry. */
	readonly eventType: "tool.failed";
	/** Tool-call id the client already saw on TOOL_CALL_START. */
	readonly toolCallId: string;
	/** Optional failure code the server picks from a fixed safe list. */
	readonly failureCode?: string;
	/** Whether the server will retry after surfacing this failed attempt. */
	readonly retrying: boolean;
	/** Explicitly typed provider-free details available behind progressive disclosure. */
	readonly technicalDetails: SafeToolTechnicalDetails;
}

/** The reasons a provider call can be left in an unknown state after it was sent. */
export enum AgUiToolRecoveryProviderOutcomes
{
	/** The call was sent, but no trusted success or failure reply reached us. */
	UnknownAfterDispatch = "unknown_after_dispatch",
	/** The claim lease expired after the provider call may already have been sent. */
	ClaimLeaseExpired = "claim_lease_expired",
	/** Re-reading state from the provider still did not show whether the call succeeded or failed. */
	ReconciliationInconclusive = "reconciliation_inconclusive",
}

/** Browser-safe payload telling the user a stored run needs a manual recovery step. */
export interface AgUiToolRecoveryRequiredEnvelope
{
	/** Canonical source event; this is not a failure, terminal, or elicitation event. */
	readonly eventType: "tool.recovery_required";
	/** Run id the client already saw in the conversation stream. */
	readonly runId: string;
	/** Attempt number a cancellation request must still match to be accepted. */
	readonly expectedAttempt: number;
	/** Tool-call id the client already saw on TOOL_CALL_START. */
	readonly toolCallId: string;
	/** Canonical event instant from the durable run-event row. */
	readonly occurredAt: string;
	/** Fixed category of user action needed. It gives the client no permission to retry or to call the provider. */
	readonly recoveryCategory: "manual_action_required";
	/** How many preparation attempts were used before any provider call was sent. */
	readonly preparationRetryCount: number;
	/** Fixed provider-free preparation attempt limit. */
	readonly preparationRetryLimit: 3;
	/** Optional fixed classification of the ambiguous provider outcome. */
	readonly providerOutcome?: AgUiToolRecoveryProviderOutcomes;
}

/** The safe, user-facing fields the server-side event reader chose to include. */
export interface AgUiPublicEventPayload
{
	readonly agentThreadDelivery?: { readonly id: string; readonly childConversationId: string; readonly kind: "status" | "question" | "approval" | "result" | "failure" | "asset"; readonly label: string; readonly detail: string; readonly assetId: string | null };
	readonly messageId?: string;
	readonly messageRole?: "assistant" | "user" | "system" | "tool";
	readonly messageState?: "pending" | "streaming" | "completed" | "failed" | "cancelled";
	readonly messageText?: string;
	readonly delta?: string;
	readonly toolCallId?: string;
	readonly toolCallName?: string;
	readonly toolResult?: string;
	readonly terminalReason?: string;
	readonly failureCode?: string;
	readonly toolFailure?: Omit<AgUiToolFailureEnvelope, "eventType" | "toolCallId">;
	readonly interrupt?: Interrupt;
	readonly a2ui?: AgUiA2uiEnvelope;
	readonly childRun?: AgUiChildRunEnvelope;
	readonly toolRecovery?: Omit<AgUiToolRecoveryRequiredEnvelope, "runId" | "occurredAt">;
}

/** A stored run event that was already authorized and stripped of unsafe fields, ready to project to AG-UI. */
export interface AgUiProjectionSourceEvent
{
	/** Replay cursor chosen by the server-side reader. Overlay events leave it out on purpose so Last-Event-ID does not advance. */
	readonly cursor?: string;
	readonly conversationId: ConversationId;
	readonly runId?: string;
	readonly position: string;
	readonly eventType: RunEventType | (string & {});
	readonly occurredAt: string;
	readonly payload: AgUiPublicEventPayload;
}

/** The upstream AG-UI standard events OpenCrane accepts, from the pinned event list. */
export type AgUiProjectionEvent = RunStartedEvent | RunFinishedEvent | RunErrorEvent | TextMessageStartEvent | TextMessageContentEvent | TextMessageEndEvent | ToolCallStartEvent | ToolCallArgsEvent | ToolCallEndEvent | ToolCallResultEvent | CustomEvent;

/** One SSE record, ready for the server's replay endpoint to write to the wire. */
export interface AgUiSseRecord
{
	/** Durable cursor. Open-interrupt overlays omit it so Last-Event-ID never advances. */
	readonly id?: string;
	readonly event: "ag-ui";
	readonly data: AgUiProjectionEvent;
}
