import { BACKWARDS, END, FORWARDS, NO_STREAM, PARK, RETRY, START, STREAM_STATE, AppendConsistencyViolationError, KurrentDBClient, StreamNotFoundError, WrongExpectedVersionError, jsonEvent, type EventType, type PersistentSubscriptionToStream, type PersistentSubscriptionToStreamResolvedEvent, type ResolvedEvent, type StreamStateCheck } from "@kurrent/kurrentdb-client";

import { HistoryExpectedRevisions, type HistoryAppend, type HistoryAppendReceipt, type HistoryAtomicAppend, type HistoryEvent, type HistoryPersistentRecordedEvent, type HistoryPersistentSubscription, type HistoryPersistentSubscriptionRequest, type HistoryReadRequest, type HistoryRecordedEvent, type HistoryStore, type HistoryStreamHead, type HistorySubscription } from "./history-store.types";

/** Adapts the official KurrentDB client to OpenCrane's stream-scoped history port. */
export class _KurrentHistoryStore implements HistoryStore
{
	/** Connects the adapter to one silo-local KurrentDB client. */
	public constructor(private readonly client: KurrentDBClient) {}

	/** Reads a finite page, yielding no events when the stream has not been created. */
	public async *readStream(request: HistoryReadRequest): AsyncIterable<HistoryRecordedEvent>
	{
		request.signal?.throwIfAborted();
		try
		{
			if (request.maxCount !== undefined || request.signal !== undefined)
			{
				for (const event of await _ReadBounded(this.client, request))
				{
					request.signal?.throwIfAborted();
					yield event;
				}
				return;
			}
			const events = this.client.readStream(request.streamName, { direction: FORWARDS, fromRevision: request.fromRevision ?? START });
			for await (const resolved of events)
			{
				if (resolved.event)
					yield _MapRecordedEvent(resolved.event);
			}
		}
		catch (error)
		{
			// Cancellation must still reject when its reason is itself a StreamNotFoundError.
			request.signal?.throwIfAborted();
			// First reads of silo, identity, and active-turn streams precede their NoStream append.
			if (!(error instanceof StreamNotFoundError))
				throw error;
		}
	}

	/** Reads the most recent revision without reading any other stream. */
	public async readHead(streamName: string): Promise<HistoryStreamHead>
	{
		const events = this.client.readStream(streamName, { direction: BACKWARDS, fromRevision: END, maxCount: 1 });
		try
		{
			for await (const resolved of events)
			{
				if (resolved.event)
					return { streamName, revision: resolved.event.revision };
			}
		}
		catch (error)
		{
			// The real client reports a stream that was never written as an error; the port promises null.
			if (!(error instanceof StreamNotFoundError))
				throw error;
		}
		return { streamName, revision: null };
	}

	/** Appends one checked stream batch through KurrentDB. */
	public async append(command: HistoryAppend): Promise<HistoryAppendReceipt>
	{
		const receipt = await this.client.appendToStream(command.streamName, command.events.map(_ToKurrentEvent), { streamState: _ToKurrentRevision(command.expectedRevision) });
		return { streamName: command.streamName, revision: receipt.nextExpectedRevision };
	}

	/** Appends checked records across streams through KurrentDB's single atomic records call. */
	public async appendAtomic(command: HistoryAtomicAppend): Promise<readonly HistoryAppendReceipt[]>
	{
		const records = command.appends.flatMap(append => append.events.map(event => ({ streamName: append.streamName, record: _ToKurrentEvent(event) })));
		const checks = _CreateAtomicChecks(command);
		try
		{
			const receipt = await this.client.appendRecords(records, checks);
			return receipt.responses.map(response => ({ streamName: response.streamName, revision: response.revision }));
		}
		catch (error)
		{
			// A stale head on the atomic path arrives as a consistency violation, not as the single-stream
			// wrong-expected-version error; callers get the same error class for both so one handler suffices.
			if (!(error instanceof AppendConsistencyViolationError) || error.violations.length === 0)
				throw error;
			const violation = error.violations[0] as (typeof error.violations)[number];
			throw new WrongExpectedVersionError(undefined, { streamName: violation.streamName, expected: violation.expectedState, current: violation.actualState });
		}
	}

	/** Opens a stream-scoped subscription that callers explicitly close. */
	public async subscribe(request: HistoryReadRequest): Promise<HistorySubscription>
	{
		// The client starts delivery after the revision it is given; the port promises delivery from it.
		const fromRevision = request.fromRevision === undefined || request.fromRevision === 0n ? START : request.fromRevision - 1n;
		const subscription = this.client.subscribeToStream(request.streamName, { fromRevision }, { highWaterMark: 1 });
		return { events: _MapSubscription(subscription), close: subscription.unsubscribe.bind(subscription) };
	}

	/**
	 * Connects to a pre-provisioned KurrentDB consumer group with explicit delivery actions.
	 *
	 * This adapter does not create groups. It maps each yielded event to the newest opaque KurrentDB
	 * delivery handle so acknowledge, retry, and park act on the delivery that KurrentDB still holds.
	 * @see https://github.com/kurrent-io/KurrentDB-Client-NodeJS/tree/v1.3.1 — the persistent-subscription client API used here.
	 */
	public async subscribePersistent(request: HistoryPersistentSubscriptionRequest): Promise<HistoryPersistentSubscription>
	{
		const subscription = this.client.subscribeToPersistentSubscriptionToStream(request.streamName, request.groupName);
		const deliveries = new Map<string, PersistentSubscriptionToStreamResolvedEvent>();
		return {
			events: _MapPersistentSubscription(subscription, deliveries),
			acknowledge: async function _Acknowledge(event): Promise<void> { await _ResolvePersistentDelivery(deliveries, event, async function _Ack(delivery) { await subscription.ack(delivery); }); },
			retry: async function _Retry(event, reason): Promise<void> { await _ResolvePersistentDelivery(deliveries, event, async function _RetryDelivery(delivery) { await subscription.nack(RETRY, reason, delivery); }); },
			park: async function _Park(event, reason): Promise<void> { await _ResolvePersistentDelivery(deliveries, event, async function _ParkDelivery(delivery) { await subscription.nack(PARK, reason, delivery); }); },
			close: async function _Close(): Promise<void> { await subscription.unsubscribe(); },
		};
	}

}

/** Builds unique KurrentDB checks and refuses an append whose own revision is not checked. */
function _CreateAtomicChecks(command: HistoryAtomicAppend): StreamStateCheck[]
{
	const heads = new Map(command.expectedHeads.map(head => [head.streamName, head.revision]));
	if (heads.size !== command.expectedHeads.length)
		throw new Error("History atomic append repeats a stream head");
	for (const append of command.appends)
	{
		const expectedHead = heads.get(append.streamName);
		if (expectedHead === undefined)
			throw new Error(`History atomic append omits '${append.streamName}' expected revision`);
		if (expectedHead !== append.expectedRevision)
			throw new Error(`History atomic append conflicts on '${append.streamName}' expected revision`);
	}
	return command.expectedHeads.map(head => ({ type: STREAM_STATE, streamName: head.streamName, expectedState: _ToKurrentRevision(head.revision) }));
}

/** Converts an OpenCrane event into the JSON record accepted by KurrentDB. */
function _ToKurrentEvent(event: HistoryEvent)
{
	return jsonEvent({ id: event.id, type: event.type, data: event.data, metadata: _ToWireMetadata(event.metadata) });
}

/**
 * Flattens event metadata to the string map every KurrentDB append path accepts.
 *
 * The atomic multi-stream append rejects any non-string metadata value before sending, and readers
 * only ever compare metadata as strings, so both append paths write the same shape: strings stay,
 * numbers, booleans and bigints become their decimal or literal text, and null or undefined fields
 * are left out. A nested value is a programming error and fails loudly instead of being mangled.
 */
function _ToWireMetadata(metadata: HistoryEvent["metadata"]): Record<string, string>
{
	const wire: Record<string, string> = {};
	for (const [key, value] of Object.entries(metadata ?? {}))
	{
		if (value === null || value === undefined)
			continue;
		if (typeof value === "string")
			wire[key] = value;
		else if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint")
			wire[key] = String(value);
		else
			throw new Error(`History event metadata '${key}' must be a flat string, number or boolean`);
	}
	return wire;
}

/** Converts an OpenCrane expected revision into the official client's stream condition. */
function _ToKurrentRevision(revision: HistoryExpectedRevisions.NoStream | bigint): typeof NO_STREAM | bigint
{
	if (revision === HistoryExpectedRevisions.NoStream)
		return NO_STREAM;
	return revision;
}

/** Maps a KurrentDB record into the port's JSON-only event shape. */
function _MapRecordedEvent(event: ResolvedEvent<EventType>["event"] & object): HistoryRecordedEvent
{
	if (!_IsRecord(event.data))
		throw new Error(`KurrentDB event '${event.id}' has a non-object payload`);
	// The client stamps its own "$schema.*" registry keys onto metadata; they are transport detail, not history.
	const metadata = Object.fromEntries(Object.entries(_IsRecord(event.metadata) ? event.metadata : {}).filter(([key]) => !key.startsWith("$schema.")));
	return { streamName: event.streamId, id: event.id, type: event.type, data: event.data, metadata, revision: event.revision, recordedAt: event.created };
}

/** Maps KurrentDB subscription records without exposing the underlying client. */
async function *_MapSubscription(subscription: AsyncIterable<ResolvedEvent<EventType>>): AsyncIterable<HistoryRecordedEvent>
{
	for await (const resolved of subscription)
	{
		if (!resolved.event)
			continue;
		yield _MapRecordedEvent(resolved.event);
	}
}

/** Maps persistent deliveries while retaining each opaque client record for a later delivery action. */
async function *_MapPersistentSubscription(subscription: PersistentSubscriptionToStream, deliveries: Map<string, PersistentSubscriptionToStreamResolvedEvent>): AsyncIterable<HistoryPersistentRecordedEvent>
{
	for await (const resolved of subscription)
	{
		if (!resolved.event)
			continue;
		const event = _MapRecordedEvent(resolved.event);
		// A KurrentDB redelivery replaces the earlier opaque handle before a consumer chooses its terminal action.
		deliveries.set(event.id, resolved);
		yield { ...event, retryCount: resolved.retryCount };
	}
}

/** Finds the current client delivery that a terminal action may use. */
function _PersistentDelivery(deliveries: Map<string, PersistentSubscriptionToStreamResolvedEvent>, event: HistoryPersistentRecordedEvent): PersistentSubscriptionToStreamResolvedEvent
{
	const delivery = deliveries.get(event.id);
	if (!delivery)
		throw new Error(`KurrentDB persistent subscription does not hold delivery '${event.id}'`);
	return delivery;
}

/** Claims one delivery before its terminal action and restores it only when that action fails. */
async function _ResolvePersistentDelivery(deliveries: Map<string, PersistentSubscriptionToStreamResolvedEvent>, event: HistoryPersistentRecordedEvent, resolve: (delivery: PersistentSubscriptionToStreamResolvedEvent) => Promise<void>): Promise<void>
{
	const delivery = _PersistentDelivery(deliveries, event);
	if (deliveries.get(event.id) === delivery)
		deliveries.delete(event.id);
	try
	{
		await resolve(delivery);
	}
	catch (error)
	{
		if (!deliveries.has(event.id))
			deliveries.set(event.id, delivery);
		throw error;
	}
}

/** Checks that an event payload or metadata value is a JSON object. */
function _IsRecord(value: unknown): value is Record<string, unknown>
{
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Reads one finite catch-up through the SDK's closeable subscription surface.
 *
 * The installed Rust-backed readStream iterator has no upstream cancellation API. The public
 * subscription delivers data before caughtUp, so either maxCount or caughtUp closes this bounded
 * read. Listeners precede data flow; the adapter's readable buffer holds at most one queued object.
 */
async function _ReadBounded(client: KurrentDBClient, request: HistoryReadRequest): Promise<readonly HistoryRecordedEvent[]>
{
	request.signal?.throwIfAborted();
	if (!Number.isSafeInteger(request.maxCount) || request.maxCount! < 1)
		throw new Error("Cancellable history reads require a positive maximum count");
	const fromRevision = request.fromRevision === undefined || request.fromRevision === 0n ? START : request.fromRevision - 1n;
	const subscription = client.subscribeToStream(request.streamName, { fromRevision }, { highWaterMark: 1 });
	const events: HistoryRecordedEvent[] = [];
	let settled = false;
	let abort: (() => void) | undefined;
	try
	{
		return await new Promise<readonly HistoryRecordedEvent[]>(function _Collect(resolve, reject)
		{
			function _Finish(error?: unknown): void
			{
				if (settled)
					return;
				settled = true;
				subscription.pause();
				if (error !== undefined)
					reject(error);
				else
					resolve(events);
			}
			abort = function _Abort() { _Finish(request.signal?.reason ?? new Error("History read aborted")); };
			subscription.once("caughtUp", function _CaughtUp() { _Finish(); });
			subscription.once("end", function _Ended() { _Finish(new Error("History catch-up ended before reaching its boundary")); });
			subscription.once("error", _Finish);
			request.signal?.addEventListener("abort", abort, { once: true });
			if (request.signal?.aborted)
				abort();
			subscription.on("data", function _Data(resolved: ResolvedEvent<EventType>)
			{
				if (settled || !resolved.event)
					return;
				try
				{
					events.push(_MapRecordedEvent(resolved.event));
					if (events.length >= request.maxCount!)
						_Finish();
				}
				catch (error) { _Finish(error); }
			});
		});
	}
	finally
	{
		if (abort !== undefined)
			request.signal?.removeEventListener("abort", abort);
		await subscription.unsubscribe();
		subscription.destroy();
	}
}
