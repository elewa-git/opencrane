import type { AgUiProjectionSourceEvent } from "@opencrane/contracts";
import type { ConversationReplayCursor } from "@opencrane/contracts";

import type { ConversationProjectionReader } from "./conversation-projection-reader.types.js";

/**
 * Sets safe bounds for one live projection response.
 *
 * The response is intentionally finite. Clients reconnect with the last cursor after the duration
 * fence, while polling and heartbeats keep the connection recoverable between durable writes.
 *
 * Called by: `__StreamConversationProjection` and server composition roots.
 */
export interface ConversationProjectionLimits
{
	/** Maximum canonical rows requested from the authorised reader at once. */
	readonly pageSize: number;
	/** Time between durable reads after the current snapshot is drained. */
	readonly pollMilliseconds: number;
	/** Maximum quiet period before the stream writes a comment heartbeat. */
	readonly heartbeatMilliseconds: number;
	/** Maximum lifetime of one response before the client reconnects. */
	readonly maximumDurationMilliseconds: number;
}

/**
 * Receives complete Server-Sent Events without tying projection policy to Express or Node streams.
 *
 * Called by: `__StreamConversationProjection`; implemented by the server HTTP adapter.
 */
export interface ConversationProjectionSink
{
	/** Opens the response after the first authorised read succeeds. */
	open(): void;
	/** Write one complete SSE frame and report whether the writable buffer remains below its limit. */
	write(value: string): boolean;
	/** Wait until a full writable buffer drains or the request is aborted. */
	drain(signal: AbortSignal): Promise<void>;
}

/**
 * Selects still-actionable approval or elicitation interrupts for the current participant.
 *
 * Called by: `ConversationOpenInterruptReader.readOpen`.
 */
export interface ReadOpenConversationInterruptsCommand
{
	/** Conversation whose open interrupts should be restored. */
	readonly conversationId: string;
	/** Trusted silo that bounds the interrupt authority. */
	readonly siloId: string;
	/** Trusted participant who may see and answer the interrupt. */
	readonly subjectId: string;
}

/**
 * Supplies the current interrupt overlay without advancing the durable conversation cursor.
 *
 * Called by: `__StreamConversationProjection`; commonly implemented by the IAM approval authority.
 */
export interface ConversationOpenInterruptReader
{
	/**
	 * Reads the complete current overlay; an empty result explicitly clears prior browser state.
	 *
	 * @param command Trusted conversation, silo and participant coordinates.
	 * @returns Cursorless redacted source events for the open interrupt set.
	 */
	readOpen(command: ReadOpenConversationInterruptsCommand): Promise<readonly AgUiProjectionSourceEvent[]>;
}

/**
 * Supplies time and abort-aware waits for production polling and deterministic tests.
 *
 * Called by: `__StreamConversationProjection`.
 */
export interface ConversationProjectionClock
{
	/** Returns a monotonic-enough millisecond value for one response's duration fences. */
	now(): number;
	/** Waits for the poll interval or resolves early when the stream is aborted. */
	wait(milliseconds: number, signal: AbortSignal): Promise<void>;
}

/**
 * Groups the framework-neutral dependencies for one authorised projection stream.
 *
 * Called by: `__StreamConversationProjection`.
 */
export interface ConversationProjectionDependencies
{
	/** Reader that checks participant authority together with each canonical page. */
	readonly reader: ConversationProjectionReader;
	/** Optional reader for cursorless approval and elicitation overlays. */
	readonly interrupts?: ConversationOpenInterruptReader;
	/** Time source used for polling, heartbeats and the duration fence. */
	readonly clock: ConversationProjectionClock;
	/** Server-owned response bounds. */
	readonly limits: ConversationProjectionLimits;
}

/**
 * Starts one stream for a participant whose coordinates came from trusted server context.
 *
 * Called by: the internal channel route and the participant-authenticated conversation route.
 */
export interface StreamConversationProjectionCommand
{
	/** Conversation selected by trusted server context. */
	readonly conversationId: string;
	/** Silo selected by trusted server context. */
	readonly siloId: string;
	/** Participant selected by trusted server context. */
	readonly subjectId: string;
	/** Last browser-acknowledged durable subframe, or `null` for a full snapshot. */
	readonly cursor: ConversationReplayCursor | null;
	/** Request, process-shutdown or caller cancellation signal. */
	readonly signal: AbortSignal;
}

/**
 * Explains why one bounded response stopped.
 *
 * The HTTP adapter uses this result for logging only. Reconnection is driven by the browser and its
 * last durable cursor, not by hidden server state.
 *
 * Called by: the server conversation replay routes.
 */
export enum ConversationProjectionOutcomes
{
	/** The configured response duration ended normally; a client may reconnect. */
	DurationReached = "duration_reached",
	/** The client or server shutdown signal ended the response. */
	Disconnected = "disconnected",
	/** Authority disappeared; the client must clear protected conversation state. */
	RevokedOrMissing = "revoked_or_missing",
}
