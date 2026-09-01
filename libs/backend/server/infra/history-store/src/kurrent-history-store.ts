import { BACKWARDS, END, FORWARDS, NO_STREAM, PARK, RETRY, START, STREAM_STATE, KurrentDBClient, jsonEvent, type EventType, type PersistentSubscriptionToStream, type PersistentSubscriptionToStreamResolvedEvent, type ResolvedEvent, type StreamStateCheck } from "@kurrent/kurrentdb-client";

import { HistoryExpectedRevisions, type HistoryAppend, type HistoryAppendReceipt, type HistoryAtomicAppend, type HistoryEvent, type HistoryPersistentRecordedEvent, type HistoryPersistentSubscription, type HistoryPersistentSubscriptionRequest, type HistoryReadRequest, type HistoryRecordedEvent, type HistoryStore, type HistoryStreamHead, type HistorySubscription } from "./history-store.types";

/** Adapts the official KurrentDB client to OpenCrane's stream-scoped history port. */
export class _KurrentHistoryStore implements HistoryStore
{
	/** Connects the adapter to one silo-local KurrentDB client. */
	public constructor(private readonly client: KurrentDBClient) {}

	/** Reads a finite page from the requested stream. */
	public async *readStream(request: HistoryReadRequest): AsyncIterable<HistoryRecordedEvent>
	{
		const events = this.client.readStream(request.streamName, { direction: FORWARDS, fromRevision: request.fromRevision ?? START });
		for await (const resolved of events)
		{
			if (!resolved.event)
				continue;
			yield _MapRecordedEvent(resolved.event);
		}
	}

	/** Reads the most recent revision without reading any other stream. */
	public async readHead(streamName: string): Promise<HistoryStreamHead>
	{
		const events = this.client.readStream(streamName, { direction: BACKWARDS, fromRevision: END, maxCount: 1 });
		for await (const resolved of events)
		{
			if (resolved.event)
				return { streamName, revision: resolved.event.revision };
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
		const receipt = await this.client.appendRecords(records, checks);
		return receipt.responses.map(response => ({ streamName: response.streamName, revision: response.revision }));
	}

	/** Opens a stream-scoped subscription that callers explicitly close. */
	public async subscribe(request: HistoryReadRequest): Promise<HistorySubscription>
	{
		const subscription = this.client.subscribeToStream(request.streamName, { fromRevision: request.fromRevision ?? START });
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
	return jsonEvent({ id: event.id, type: event.type, data: event.data, metadata: event.metadata });
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
	const metadata = _IsRecord(event.metadata) ? event.metadata : {};
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
