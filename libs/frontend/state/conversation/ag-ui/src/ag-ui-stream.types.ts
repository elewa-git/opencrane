import type { AgUiProjectionEvent } from "@opencrane/contracts";

/** Browser-owned view of one safe assistant message assembled from the projection. */
export interface AgUiMessageView
{
	/** Stable message identifier. */
	readonly id: string;
	/** Assembled display-safe assistant text. */
	readonly text: string;
	/** Whether the stream completed this message. */
	readonly complete: boolean;
}
/** Browser-owned view of one safe tool lifecycle. */
export interface AgUiToolView
{
	/** Stable tool-call identifier. */
	readonly id: string;
	/** Display-safe tool name. */
	readonly name: string | null;
	/** Whether the tool lifecycle ended. */
	readonly complete: boolean;
	/** Display-safe tool result, when emitted. */
	readonly result: string | null;
}
/** Immutable reduced state for one replayable projected event stream. */
export interface AgUiStreamState
{
	/** Latest durable cursor accepted from the authoritative replay source. */
	readonly cursor: string | null;
	/** Cursors already reduced in this in-memory stream session. */
	readonly seenCursors: ReadonlySet<string>;
	/** Current run identifier, when started by the stream. */
	readonly runId: string | null;
	/** Assistant messages assembled from safe events. */
	readonly messages: Readonly<Record<string, AgUiMessageView>>;
	/** Tool lifecycles assembled from safe events. */
	readonly tools: Readonly<Record<string, AgUiToolView>>;
	/** Names of payload-free custom display signals. */
	readonly customEvents: readonly string[];
}
/** Decoded SSE record before it is reduced into view state. */
export interface AgUiStreamRecord
{
	/** Opaque durable SSE cursor. */
	readonly id: string;
	/** Fixed versioned projection event name. */
	readonly event: "ag-ui";
	/** Validated display-safe projection data. */
	readonly data: AgUiProjectionEvent;
}
