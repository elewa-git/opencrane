import type { Interrupt, TextMessageStartEvent } from "@ag-ui/core";
import type { AgUiA2uiEnvelope, AgUiProjectionEvent } from "@opencrane/contracts";

/** Browser-visible lifecycle for one projected conversation run. */
export enum AgUiRunStatuses
{
	/** No run has been observed. */
	Idle = "idle",
	/** The authoritative stream started a run. */
	Running = "running",
	/** The authoritative stream completed a run successfully. */
	Succeeded = "succeeded",
	/** The authoritative stream ended because user input remains required. */
	Interrupted = "interrupted",
	/** The authoritative stream reported a run failure. */
	Failed = "failed",
	/** The authoritative stream reported cancellation. */
	Cancelled = "cancelled",
}

/** Browser-visible lifecycle for one projected conversation message. */
export enum AgUiMessageStatuses
{
	/** Message content may still receive deltas. */
	Streaming = "streaming",
	/** Message content completed normally. */
	Completed = "completed",
	/** Message generation failed. */
	Failed = "failed",
	/** Message generation was cancelled. */
	Cancelled = "cancelled",
}

/** Browser-visible lifecycle for one projected tool call. */
export enum AgUiToolStatuses
{
	/** The tool call was requested and may still progress. */
	Requested = "requested",
	/** The authoritative stream reported successful completion. */
	Completed = "completed",
	/** The authoritative stream reported a failure, including before later model recovery. */
	Failed = "failed",
	/** The tool later completed, while retaining the earlier visible failure evidence. */
	Recovered = "recovered",
}

/** One safe failure retained in a tool call's visible lifecycle history. */
export interface AgUiToolFailure
{
	/** Optional server-selected technical classification for this failed attempt. */
	readonly code: string | null;
}

/** Browser-owned view of one safe conversation message. */
export interface AgUiMessageView
{
	/** Stable message identifier. */
	readonly id: string;
	/** Projected AG-UI role. */
	readonly role: TextMessageStartEvent["role"];
	/** Assembled display-safe message text. */
	readonly text: string;
	/** Truthful terminal or streaming state. */
	readonly status: AgUiMessageStatuses;
}

/** Browser-owned view of one safe tool lifecycle. */
export interface AgUiToolView
{
	/** Stable tool-call identifier. */
	readonly id: string;
	/** Display-safe tool name. */
	readonly name: string;
	/** Incremental JSON arguments emitted by the projection. */
	readonly arguments: string;
	/** Truthful projected tool lifecycle. */
	readonly status: AgUiToolStatuses;
	/** Display-safe tool result, when emitted. */
	readonly result: string | null;
	/** Optional server-selected technical classification for a failure. */
	readonly failureCode: string | null;
	/** Ordered failure evidence retained even when a later attempt recovers. */
	readonly failures: readonly AgUiToolFailure[];
}

/** Safe failure selected by the server-owned AG-UI projection. */
export interface AgUiRunFailure
{
	/** Display-safe failure message. */
	readonly message: string;
	/** Optional server-selected failure code. */
	readonly code?: string;
}

/** Immutable reduced state for one live projected event stream. */
export interface AgUiStreamState
{
	/** Latest durable cursor accepted from the authoritative stream. */
	readonly cursor: string | null;
	/** Fingerprints used to reject duplicated or mutated durable cursor records. */
	readonly seenCursors: ReadonlyMap<string, string>;
	/** Current run identifier, when supplied by the stream. */
	readonly runId: string | null;
	/** Truthful current run lifecycle. */
	readonly runStatus: AgUiRunStatuses;
	/** Safe terminal failure, when the run failed or was cancelled. */
	readonly runFailure: AgUiRunFailure | null;
	/** Still-open AG-UI interrupts. Cursorless reconnect overlays replace this set. */
	readonly interrupts: readonly Interrupt[];
	/** Conversation messages assembled from safe events. */
	readonly messages: Readonly<Record<string, AgUiMessageView>>;
	/** Tool lifecycles assembled from safe events. */
	readonly tools: Readonly<Record<string, AgUiToolView>>;
	/** Governed A2UI surfaces keyed by their complete stable presentation identity. */
	readonly surfaces: ReadonlyMap<string, AgUiA2uiEnvelope>;
	/** Latest source-envelope fingerprints used to detect same-sequence mutation after materialization. */
	readonly surfaceFingerprints: ReadonlyMap<string, string>;
	/** Names of custom display signals; their authority-bearing source payloads stay server-side. */
	readonly customEvents: readonly string[];
	/** Whether authority loss purged this in-memory projection. */
	readonly accessRevoked: boolean;
}

/** Decoded SSE record before it is reduced into view state. */
export interface AgUiStreamRecord
{
	/** Opaque durable SSE cursor. Cursorless records are non-durable overlays. */
	readonly id?: string;
	/** Fixed versioned projection event name. */
	readonly event: "ag-ui";
	/** Validated display-safe projection data. */
	readonly data: AgUiProjectionEvent;
}
