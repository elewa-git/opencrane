/** Selects the current stream condition that an append must prove before it can commit. */
export enum HistoryExpectedRevisions
{
	/** Requires a stream that has not yet received an event. */
	NoStream = "no_stream",
}

/** Represents a stream and its revision condition for an atomic append. */
export interface HistoryExpectedHead
{
	/** Names the stream whose current revision is checked. */
	readonly streamName: string;
	/** Requires a missing stream or the last committed revision. */
	readonly revision: HistoryExpectedRevisions.NoStream | bigint;
}

/** Carries one JSON event that the HistoryStore may append. */
export interface HistoryEvent
{
	/** Supplies the caller-chosen UUID used to make retried appends idempotent. */
	readonly id: string;
	/** Names the versioned event schema. */
	readonly type: string;
	/** Holds the validated event payload without credentials or plaintext private content. */
	readonly data: Record<string, unknown>;
	/** Holds the validated event metadata such as causation and correlation coordinates. */
	readonly metadata: Record<string, unknown>;
}

/** Adds a sequence of events to one stream. */
export interface HistoryAppend
{
	/** Names the stream that receives every event in this append. */
	readonly streamName: string;
	/** States the stream condition that must hold before the append commits. */
	readonly expectedRevision: HistoryExpectedRevisions.NoStream | bigint;
	/** Lists the events in their requested stream order. */
	readonly events: readonly HistoryEvent[];
}

/** Adds events to one or more streams after every supplied stream condition is checked. */
export interface HistoryAtomicAppend
{
	/** Lists every stream condition checked in the same KurrentDB append transaction. */
	readonly expectedHeads: readonly HistoryExpectedHead[];
	/** Lists the event writes that commit with those checks. */
	readonly appends: readonly HistoryAppend[];
}

/** Reports the committed revision for one stream. */
export interface HistoryStreamHead
{
	/** Names the stream that was read. */
	readonly streamName: string;
	/** Reports the stream's last revision, or null when the stream has no events. */
	readonly revision: bigint | null;
}

/** Reports the revision that an append committed for its target stream. */
export interface HistoryAppendReceipt
{
	/** Names the stream that accepted the events. */
	readonly streamName: string;
	/** Reports the new last revision after commit. */
	readonly revision: bigint;
}

/** Presents one event read from a HistoryStore stream. */
export interface HistoryRecordedEvent extends HistoryEvent
{
	/** Names the stream that owns this event. */
	readonly streamName: string;
	/** Records the immutable position within that stream. */
	readonly revision: bigint;
	/** Records when KurrentDB accepted the event. */
	readonly recordedAt: Date;
}

/** Defines the stream cursor for a finite read or a live subscription. */
export interface HistoryReadRequest
{
	/** Names the one stream the caller may read. */
	readonly streamName: string;
	/** Starts at this stream revision, or at the first event when omitted. */
	readonly fromRevision?: bigint;
}

/**
 * Selects a KurrentDB persistent consumer group for one ordered history stream.
 *
 * The adapter opens this group but does not create it, so deployment or a controller must provision
 * the named group before a consumer subscribes. Keeping the group name explicit prevents one
 * listener from accidentally sharing another listener's acknowledgement checkpoint.
 */
export interface HistoryPersistentSubscriptionRequest
{
	/** Names the one stream whose deliveries this consumer group receives. */
	readonly streamName: string;
	/** Names the already-provisioned durable consumer group. */
	readonly groupName: string;
}

/**
 * Extends a recorded event with KurrentDB's persistent-delivery retry count.
 *
 * A nonzero count means KurrentDB has delivered the event to this consumer group before. It does
 * not identify a specific client delivery handle, which remains inside the adapter for the next
 * acknowledgement, retry, or park action.
 */
export interface HistoryPersistentRecordedEvent extends HistoryRecordedEvent
{
	/** Reports how often KurrentDB has redelivered this event to the consumer group. */
	readonly retryCount: number;
}

/** Gives callers a narrow history port without PostgreSQL or global-ledger fallback. */
export interface HistoryStore
{
	/** Reads events in one stream from the requested revision. */
	readStream(request: HistoryReadRequest): AsyncIterable<HistoryRecordedEvent>;
	/** Reads the latest revision without exposing a global ledger cursor. */
	readHead(streamName: string): Promise<HistoryStreamHead>;
	/** Commits one stream append after its expected revision check succeeds. */
	append(command: HistoryAppend): Promise<HistoryAppendReceipt>;
	/** Commits checked records across streams through KurrentDB's atomic append API. */
	appendAtomic(command: HistoryAtomicAppend): Promise<readonly HistoryAppendReceipt[]>;
	/** Streams new entries for one named stream and lets the caller stop the subscription. */
	subscribe(request: HistoryReadRequest): Promise<HistorySubscription>;
	/**
	 * Connects to a provisioned persistent consumer group.
	 *
	 * The returned subscription is at-least-once: each delivery needs an explicit acknowledge, retry,
	 * or park action. Closing the connection does not acknowledge outstanding deliveries.
	 * @param request - Names the stream and pre-provisioned consumer group.
	 * @returns A consumer that exposes deliveries and their terminal actions.
	 * @throws {Error} Propagates a KurrentDB connection failure.
	 */
	subscribePersistent(request: HistoryPersistentSubscriptionRequest): Promise<HistoryPersistentSubscription>;
}

/** Carries one active stream subscription and its explicit cleanup action. */
export interface HistorySubscription
{
	/** Iterates events delivered after the requested stream revision. */
	readonly events: AsyncIterable<HistoryRecordedEvent>;
	/** Stops the KurrentDB stream subscription. */
	close(): Promise<void>;
}

/**
 * Holds one KurrentDB persistent-consumer connection and its delivery actions.
 *
 * Delivery is at least once, so a caller must make handling idempotent and choose exactly one action
 * for a currently delivered event. The adapter retains the current opaque delivery handle; a newer
 * redelivery supersedes its earlier handle.
 */
export interface HistoryPersistentSubscription
{
	/** Iterates at-least-once deliveries from the named consumer group. */
	readonly events: AsyncIterable<HistoryPersistentRecordedEvent>;
	/** Confirms one currently delivered event so KurrentDB may advance the group checkpoint. */
	acknowledge(event: HistoryPersistentRecordedEvent): Promise<void>;
	/** Requests that KurrentDB redeliver one currently delivered event after a transient failure. */
	retry(event: HistoryPersistentRecordedEvent, reason: string): Promise<void>;
	/** Moves one currently delivered poison event to the consumer group's parked queue. */
	park(event: HistoryPersistentRecordedEvent, reason: string): Promise<void>;
	/** Closes the consumer connection without acknowledging its outstanding deliveries. */
	close(): Promise<void>;
}
