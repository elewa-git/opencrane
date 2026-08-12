import type { AgUiProjectionSourceEvent } from "@opencrane/contracts";

/**
 * Represents one canonical timeline row selected by an authorised conversation reader.
 *
 * The payload is still untrusted at this boundary. `__ProjectConversationEvent` is the only step
 * allowed to turn it into a public source event.
 *
 * Called by: server conversation readers and `__StreamConversationProjection`.
 */
export interface ConversationProjectionEventRow
{
	/** Opaque durable cursor for this exact immutable row. */
	readonly cursor: string;
	/** Authorised conversation that owns the timeline row. */
	readonly conversationId: string;
	/** Run that owns an agent event, or `null` for an ordinary conversation message. */
	readonly runId: string | null;
	/** Database-owned canonical timeline position. */
	readonly position: string;
	/** Canonical public event name. */
	readonly type: string;
	/** Untrusted JSON payload stored with the canonical event. */
	readonly payload: Readonly<Record<string, unknown>>;
	/** Immutable event time in ISO-8601 UTC form. */
	readonly occurredAt: string;
}

/** Display-safe projection result, or `null` when the canonical row is not valid for browser output. */
export type ConversationEventProjectionResult = AgUiProjectionSourceEvent | null;
