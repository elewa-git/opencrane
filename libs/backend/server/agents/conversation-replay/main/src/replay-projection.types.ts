import type { AgUiProjectionSourceEvent } from "@opencrane/contracts";

/** One canonical event row already selected by an authorised thread replay query. */
export interface ConversationReplayEventRow
{
	/** Opaque durable cursor for this exact immutable row. */
	readonly cursor: string;
	/** Authorised thread associated with the run. */
	readonly threadId: string;
	/** Run that owns the event. */
	readonly runId: string;
	/** Contiguous canonical sequence. */
	readonly sequence: number;
	/** Canonical public event name. */
	readonly type: string;
	/** Untrusted JSON payload stored with the canonical event. */
	readonly payload: Readonly<Record<string, unknown>>;
	/** Immutable event time in ISO-8601 UTC form. */
	readonly occurredAt: string;
}

/** Display-safe projection result, or null when the canonical row is not valid for browser output. */
export type ConversationReplayProjectionResult = AgUiProjectionSourceEvent | null;
