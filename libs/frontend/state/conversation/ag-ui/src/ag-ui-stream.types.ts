import type { Interrupt } from "@ag-ui/core";
import type { AgUiA2uiEnvelope, AgUiProjectionEvent, AgUiToolRecoveryRequiredEnvelope } from "@opencrane/contracts";

import type { AgUiAgentThreadParentDelivery } from "./agent-thread-delivery/agent-thread-delivery.types";
import type { AgUiMessageView } from "./message/message.types";
import type { AgUiRunFailure, AgUiRunStatuses } from "./run/run.types";
import type { AgUiToolView } from "./tool/tool.types";

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
	/** Latest append-only parent deliveries keyed by delivery id for live compact summaries. */
	readonly agentThreadParentDeliveries: Readonly<Record<string, AgUiAgentThreadParentDelivery>>;
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
