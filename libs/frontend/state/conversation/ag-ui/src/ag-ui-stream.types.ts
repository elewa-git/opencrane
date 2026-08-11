import type { Interrupt, TextMessageStartEvent } from "@ag-ui/core";
import type { AgUiA2uiEnvelope, AgUiProjectionEvent, AgUiToolRecoveryRequiredEnvelope, SafeToolTechnicalDetails } from "@opencrane/contracts";

/**
 * How a conversation run is going, as far as the browser can tell.
 *
 * The distinction that matters is between `Failed` and `NeedsRecovery`. `Failed` means the run
 * ended and may be retried. `NeedsRecovery` means an external action was started and its outcome
 * is unknown — retrying could repeat it, so the UI must offer cancelling and nothing else.
 * `Interrupted` is not a failure at all: the run stopped because it needs input from the user.
 *
 * @see AgUiToolStatuses
 */
export enum AgUiRunStatuses
{
	/** No run has been observed. */
	Idle = "idle",
	/** The server stream started a run. */
	Running = "running",
	/** The authoritative stream completed a run successfully. */
	Succeeded = "succeeded",
	/** The authoritative stream ended because user input remains required. */
	Interrupted = "interrupted",
	/** An external action has an ambiguous outcome and the run can only be cancelled safely. */
	NeedsRecovery = "needs_recovery",
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

/**
 * How a single tool call is going.
 *
 * `Recovered` and `Completed` both mean the call ended successfully, but `Recovered` says it failed
 * at least once first, and those earlier failures are still listed in `failures` — a UI that hides
 * them loses the only record. `NeedsRecovery` means the action must not be dispatched again.
 *
 * @see AgUiToolView
 * @see AgUiRunStatuses
 */
export enum AgUiToolStatuses
{
	/** The tool call was requested and may still progress. */
	Requested = "requested",
	/** The authoritative stream reported successful completion. */
	Completed = "completed",
	/** The authoritative stream reported a failure, including before later model recovery. */
	Failed = "failed",
	/** The action outcome is ambiguous and must not be dispatched again. */
	NeedsRecovery = "needs_recovery",
	/** The tool later completed, while retaining the earlier visible failure evidence. */
	Recovered = "recovered",
}

/** One recorded failure of a tool call, kept even after a later attempt succeeds. */
export interface AgUiToolFailure
{
	/** Optional server-selected technical classification for this failed attempt. */
	readonly code: string | null;
	/** Whether the control plane will retry after this visible failed attempt. */
	readonly retrying: boolean;
	/** Provider-free details shown only after the user opens technical disclosure. */
	readonly technicalDetails: SafeToolTechnicalDetails;
}

/** One conversation message, assembled in the browser from the stream's text events. */
export interface AgUiMessageView
{
	/** Stable message identifier. */
	readonly id: string;
	/** Projected AG-UI role. */
	readonly role: TextMessageStartEvent["role"];
	/** Assembled display-safe message text. */
	readonly text: string;
	/** Whether the message is finished or still streaming, exactly as the server reported it. */
	readonly status: AgUiMessageStatuses;
}

/** One tool call, assembled in the browser from the stream's tool events. */
export interface AgUiToolView
{
	/** Stable tool-call identifier. */
	readonly id: string;
	/** Display-safe tool name. */
	readonly name: string;
	/** The tool's arguments as JSON text, appended delta by delta; may be incomplete while streaming. */
	readonly arguments: string;
	/** Truthful projected tool lifecycle. */
	readonly status: AgUiToolStatuses;
	/** Display-safe tool result, when emitted. */
	readonly result: string | null;
	/** Optional server-selected technical classification for a failure. */
	readonly failureCode: string | null;
	/** Every failure so far, in order; kept even after a later attempt recovers. */
	readonly failures: readonly AgUiToolFailure[];
	/** Recovery details safe to show, kept after the run is cancelled or reconciled. */
	readonly recovery: AgUiToolRecoveryRequiredEnvelope | null;
}

/** Why a run failed, in words the server has already made safe to display. */
export interface AgUiRunFailure
{
	/** Display-safe failure message. */
	readonly message: string;
	/** Optional server-selected failure code. */
	readonly code?: string;
}

/**
 * Everything the browser knows about one live conversation, rebuilt from the event stream.
 *
 * Never mutated: {@link __ReduceAgUiStream} returns a new object each time. This is the single
 * value a conversation UI renders from, and the value to pass back in when reconnecting — `cursor`
 * and `seenCursors` are what make a reconnect resume instead of replay.
 *
 * `messages` and `tools` are keyed by id rather than ordered, so a view that needs chronological
 * order must impose it. `accessRevoked` means the user lost access and everything here was
 * deliberately cleared; show a revoked state, not an error.
 *
 * @see __ReduceAgUiStream
 * @see AG-UI protocol docs — the events these views are assembled from: https://docs.ag-ui.com
 */
export interface AgUiStreamState
{
	/** The most recent cursor accepted from the server; what a reconnect resumes from. */
	readonly cursor: string | null;
	/** A hash per cursor, so a repeated cursor is ignored and a cursor reused with different data throws. */
	readonly seenCursors: ReadonlyMap<string, string>;
	/** Current run identifier, when supplied by the stream. */
	readonly runId: string | null;
	/** Truthful current run lifecycle. */
	readonly runStatus: AgUiRunStatuses;
	/** Safe terminal failure, when the run failed or was cancelled. */
	readonly runFailure: AgUiRunFailure | null;
	/** Exact display-safe recovery evidence for the current run, when provider outcome is ambiguous. */
	readonly runRecovery: AgUiToolRecoveryRequiredEnvelope | null;
	/** Still-open AG-UI interrupts. Cursorless reconnect overlays replace this set. */
	readonly interrupts: readonly Interrupt[];
	/** Conversation messages assembled from safe events. */
	readonly messages: Readonly<Record<string, AgUiMessageView>>;
	/** Tool lifecycles assembled from safe events. */
	readonly tools: Readonly<Record<string, AgUiToolView>>;
	/** A2UI surfaces, keyed by their conversation, run, message and surface ids joined together. */
	readonly surfaces: ReadonlyMap<string, AgUiA2uiEnvelope>;
	/** A hash of each surface's last envelope, so a payload that changes without its sequence changing is caught. */
	readonly surfaceFingerprints: ReadonlyMap<string, string>;
	/** Names of the custom events seen; the payloads that could carry authority stay on the server. */
	readonly customEvents: readonly string[];
	/** Whether the user lost access, in which case everything above was cleared on purpose. */
	readonly accessRevoked: boolean;
}

/**
 * One SSE frame after decoding, ready to reduce.
 *
 * `id` is the server's cursor. When it is present the record is durable and advances the resume
 * position; when it is absent the record is a temporary overlay that must not move the cursor —
 * that is how a reconnect avoids replaying overlay state.
 *
 * @see __DecodeAgUiSseRecord
 * @see __ReduceAgUiStream
 */
export interface AgUiStreamRecord
{
	/** The server's cursor — treat it as an opaque string and never parse it. A record without one is a temporary overlay. */
	readonly id?: string;
	/** Fixed versioned projection event name. */
	readonly event: "ag-ui";
	/** Validated display-safe projection data. */
	readonly data: AgUiProjectionEvent;
}
