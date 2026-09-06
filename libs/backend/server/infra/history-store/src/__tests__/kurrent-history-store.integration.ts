import { randomUUID } from "node:crypto";

import { KurrentDBClient, PersistentSubscriptionMaximumSubscribersReachedError, ROUND_ROBIN, StreamNotFoundError, WrongExpectedVersionError, persistentSubscriptionToStreamSettingsFromDefaults } from "@kurrent/kurrentdb-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { HistoryExpectedRevisions, type HistoryEvent, type HistoryPersistentRecordedEvent, type HistoryRecordedEvent } from "../history-store.types";
import { _KurrentHistoryStore } from "../kurrent-history-store";

/**
 * Live proofs for `_KurrentHistoryStore` against a real KurrentDB 26.x.
 *
 * ADR 0016 requires the admission test to prove that the actual client and topology support every
 * exposed HistoryStore operation. The unit tests mock the client, so this file is the only place that
 * exercises `@kurrent/kurrentdb-client` 1.3.x wire behaviour: checked appends, the atomic multi-stream
 * append used for genesis and message+activation, the exact conflict error the authorities catch,
 * reads, catch-up subscriptions, and the persistent consumer group with ack, retry, park, and replay.
 *
 * Set `KURRENTDB_INTEGRATION_URL` (for example `kurrentdb://localhost:2113?tls=false`) to run it.
 * Without it the suite skips. Stream names carry a UUID so re-runs against one server never collide.
 * @see docs/adr/0016-conversation-history-and-computers.md
 */

/** Names the one environment variable that opts a machine into the live suite. */
const _URL_VARIABLE = "KURRENTDB_INTEGRATION_URL";
/** Holds the connection string, or undefined when the suite must skip. */
const _URL = process.env[_URL_VARIABLE];
/** Uses the consumer-group name the Helm bootstrap Job provisions for the activation queue. */
const _ACTIVATION_GROUP = "conversation-computer-activation";
/** Bounds every wait on a delivery so a silent subscription fails the test instead of hanging it. */
const _DELIVERY_TIMEOUT_MS = 15_000;

/** Builds one JSON event with a fresh UUID so no two appends in a run share an event identifier. */
function _event(type: string, data: Record<string, unknown>, metadata: Record<string, unknown> = {}): HistoryEvent
{
	return { id: randomUUID(), type, data, metadata };
}

/** Names a stream that no earlier run of this suite can have created. */
function _stream(prefix: string): string
{
	return `${prefix}-${randomUUID()}`;
}

/** Reduces a recorded event to the fields a caller compares, dropping the server-assigned timestamp. */
function _shape(event: HistoryRecordedEvent)
{
	return { streamName: event.streamName, id: event.id, type: event.type, data: event.data, metadata: event.metadata, revision: event.revision };
}

/** Reads a finite stream page to the end. */
async function _collect(events: AsyncIterable<HistoryRecordedEvent>): Promise<HistoryRecordedEvent[]>
{
	const collected: HistoryRecordedEvent[] = [];
	for await (const event of events)
		collected.push(event);
	return collected;
}

/** Rejects a pending promise after the timeout so a quiet subscription cannot stall the suite. */
function _within<T>(promise: Promise<T>, reason: string, timeoutMs = _DELIVERY_TIMEOUT_MS): Promise<T>
{
	return new Promise<T>(function _race(resolve, reject)
	{
		const timer = setTimeout(function _expire() { reject(new Error(reason)); }, timeoutMs);
		promise.then(function _settle(value) { clearTimeout(timer); resolve(value); }, function _fail(error) { clearTimeout(timer); reject(error); });
	});
}

/** Takes the next delivery from a subscription and fails when the iterator ends or stays silent. */
async function _next<T>(iterator: AsyncIterator<T>, reason: string): Promise<T>
{
	const result = await _within(iterator.next(), reason);
	if (result.done)
		throw new Error(`${reason}: the subscription ended instead of delivering`);
	return result.value;
}

/** Polls a condition until it holds, or fails with the given reason after the timeout. */
async function _eventually(check: () => Promise<boolean>, reason: string, timeoutMs = _DELIVERY_TIMEOUT_MS): Promise<void>
{
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline)
	{
		if (await check())
			return;
		await new Promise(function _pause(resolve) { setTimeout(resolve, 250); });
	}
	throw new Error(reason);
}

/** Renders an unknown error with its class name so a CI log shows exactly what the client raised. */
function _describeError(error: unknown): string
{
	if (error instanceof Error)
		return `${error.constructor.name}: ${error.message}`;
	return String(error);
}

/**
 * Awaits an append that must fail with the stale-head error the authorities catch.
 *
 * `conversation-history-authority.ts`, `agent-session-history.ts`, and `conversation-computer-turn-store.ts`
 * all test `error instanceof WrongExpectedVersionError`; any other class would surface as a 500 in production,
 * so this helper names the real class in its failure message.
 */
async function _staleHeadConflict(attempt: Promise<unknown>): Promise<WrongExpectedVersionError>
{
	try
	{
		await attempt;
	}
	catch (error)
	{
		if (error instanceof WrongExpectedVersionError)
			return error;
		throw new Error(`expected WrongExpectedVersionError but the client raised ${_describeError(error)}`);
	}
	throw new Error("expected a stale-head conflict but the append committed");
}

/** Reports whether KurrentDB created the stream, using the raw client so the port's readHead is proven separately. */
async function _streamExists(client: KurrentDBClient, streamName: string): Promise<boolean>
{
	try
	{
		for await (const _resolved of client.readStream(streamName, { maxCount: 1 }))
			return true;
		return false;
	}
	catch (error)
	{
		if (error instanceof StreamNotFoundError)
			return false;
		throw error;
	}
}

/**
 * Mirrors the consumer-group settings the Helm bootstrap Job provisions over HTTP.
 *
 * The HTTP body in `apps/_infra/kurrentdb/helm/templates/_resources.tpl` uses the REST field names; the gRPC
 * client names the same settings differently: `bufferSize` is `historyBufferSize`, `minCheckPointCount` is
 * `checkPointLowerBound`, `maxCheckPointCount` is `checkPointUpperBound`, and the millisecond suffixes drop.
 */
function _activationGroupSettings()
{
	return persistentSubscriptionToStreamSettingsFromDefaults({ resolveLinkTos: false, startFrom: 0n, messageTimeout: 60_000, extraStatistics: false, maxRetryCount: 60, liveBufferSize: 500, historyBufferSize: 500, readBatchSize: 20, checkPointAfter: 1_000, checkPointLowerBound: 10, checkPointUpperBound: 1_000, maxSubscriberCount: 1, consumerStrategyName: ROUND_ROBIN });
}

/** Narrows a settled result to a rejection so the test can inspect the losing writer's error. */
function _isRejected(result: PromiseSettledResult<unknown>): result is PromiseRejectedResult
{
	return "reason" in result;
}

it.skipIf(_URL !== undefined)(`skips the live KurrentDB proofs because ${_URL_VARIABLE} is unset`, function ()
{
	expect(_URL).toBeUndefined();
});

describe.skipIf(_URL === undefined)("_KurrentHistoryStore against a live KurrentDB", function ()
{
	let client: KurrentDBClient;
	let store: _KurrentHistoryStore;

	beforeAll(function _connect()
	{
		client = KurrentDBClient.connectionString(_URL ?? "");
		store = new _KurrentHistoryStore(client);
	});

	afterAll(async function _disconnect()
	{
		await client.dispose();
	});

	it("creates a stream with the no-stream condition, extends it at its head, and reads it back in order", async function ()
	{
		const streamName = _stream("conversation");
		const created = _event("opencrane.conversation-created.v1", { genesis: { conversationId: streamName, mode: "direct" } }, { siloId: "silo-1", conversationId: streamName, causationId: "event-1", correlationId: "event-1", idempotencyKey: "event-1" });
		const entry = _event("opencrane.conversation-entry.v1", { entry: { position: "1" } }, { siloId: "silo-1", conversationId: streamName });

		const genesis = await store.append({ streamName, expectedRevision: HistoryExpectedRevisions.NoStream, events: [created] });
		const extended = await store.append({ streamName, expectedRevision: genesis.revision, events: [entry] });
		const head = await store.readHead(streamName);
		const events = await _collect(store.readStream({ streamName }));
		const tail = await _collect(store.readStream({ streamName, fromRevision: 1n }));

		expect(genesis).toEqual({ streamName, revision: 0n });
		expect(extended).toEqual({ streamName, revision: 1n });
		expect(head).toEqual({ streamName, revision: 1n });
		expect(events.map(_shape)).toEqual([{ ...created, streamName, revision: 0n }, { ...entry, streamName, revision: 1n }]);
		expect(events[0]?.recordedAt).toBeInstanceOf(Date);
		expect(tail.map(_shape)).toEqual([{ ...entry, streamName, revision: 1n }]);
	});

	it("reports a null head for a stream that has no events yet", async function ()
	{
		// `prisma-self-conversation-history.ts` reads the silo activation queue head before the first activation
		// exists, and `agent-identity-history.ts` reads a not-yet-created identity stream; both rely on null here.
		const streamName = _stream("computer-activations");

		const head = await store.readHead(streamName);

		expect(head).toEqual({ streamName, revision: null });
	});

	it("raises WrongExpectedVersionError naming the stream when a writer's expected head is stale", async function ()
	{
		const streamName = _stream("conversation");
		await store.append({ streamName, expectedRevision: HistoryExpectedRevisions.NoStream, events: [_event("opencrane.conversation-created.v1", { genesis: {} })] });

		const repeatedGenesis = await _staleHeadConflict(store.append({ streamName, expectedRevision: HistoryExpectedRevisions.NoStream, events: [_event("opencrane.conversation-created.v1", { genesis: {} })] }));
		const staleWriter = await _staleHeadConflict(store.append({ streamName, expectedRevision: 5n, events: [_event("opencrane.conversation-entry.v1", { entry: {} })] }));

		expect(repeatedGenesis.streamName).toBe(streamName);
		expect(repeatedGenesis.actualState).toBe(0n);
		expect(staleWriter.streamName).toBe(streamName);
		expect(staleWriter.expectedState).toBe(5n);
		expect(staleWriter.actualState).toBe(0n);
		expect(await store.readHead(streamName)).toEqual({ streamName, revision: 0n });
	});

	it("lets exactly one of two writers racing on the same head win", async function ()
	{
		const streamName = _stream("conversation");
		const genesis = await store.append({ streamName, expectedRevision: HistoryExpectedRevisions.NoStream, events: [_event("opencrane.conversation-created.v1", { genesis: {} })] });

		const race = await Promise.allSettled([0, 1].map(writer => store.append({ streamName, expectedRevision: genesis.revision, events: [_event("opencrane.conversation-entry.v1", { entry: { writer } })] })));
		const losers = race.filter(_isRejected);

		expect(losers).toHaveLength(1);
		expect(losers[0]?.reason).toBeInstanceOf(WrongExpectedVersionError);
		expect(await store.readHead(streamName)).toEqual({ streamName, revision: 1n });
		expect(await _collect(store.readStream({ streamName }))).toHaveLength(2);
	});

	it("commits the conversation genesis and its computer stream together in one atomic append", async function ()
	{
		const conversationStream = _stream("conversation");
		const computerStream = _stream("conversation-computer");
		const created = _event("opencrane.conversation-created.v1", { genesis: { mode: "agent_session" } }, { siloId: "silo-1", conversationId: "conversation-1", causationId: "event-1", correlationId: "event-1", idempotencyKey: "event-1" });
		const computer = _event("opencrane.conversation-computer.v1", { computer: { state: "cold", leaseGeneration: 1 }, lease: null }, { siloId: "silo-1", computerId: "computer-1", conversationId: "conversation-1" });

		const receipts = await store.appendAtomic({ expectedHeads: [{ streamName: conversationStream, revision: HistoryExpectedRevisions.NoStream }, { streamName: computerStream, revision: HistoryExpectedRevisions.NoStream }], appends: [{ streamName: conversationStream, expectedRevision: HistoryExpectedRevisions.NoStream, events: [created] }, { streamName: computerStream, expectedRevision: HistoryExpectedRevisions.NoStream, events: [computer] }] });
		const conversationEvents = await _collect(store.readStream({ streamName: conversationStream }));
		const computerEvents = await _collect(store.readStream({ streamName: computerStream }));

		expect(receipts).toHaveLength(2);
		expect(receipts).toEqual(expect.arrayContaining([{ streamName: conversationStream, revision: 0n }, { streamName: computerStream, revision: 0n }]));
		expect(conversationEvents.map(_shape)).toEqual([{ ...created, streamName: conversationStream, revision: 0n }]);
		expect(computerEvents.map(_shape)).toEqual([{ ...computer, streamName: computerStream, revision: 0n }]);
	});

	it("accepts the computer genesis metadata that agent-session creation appends atomically", async function ()
	{
		// Mirrors `_ensureGenesisAndComputer` in libs/backend/server/conversations/main/src/agent-session-history.ts,
		// whose computer event carries leaseId, leaseGeneration, and leaseState as null before the first lease exists.
		const conversationStream = _stream("conversation");
		const computerStream = _stream("conversation-computer");
		const created = _event("opencrane.conversation-created.v1", { genesis: { mode: "agent_session" } }, { siloId: "silo-1", conversationId: "conversation-1", causationId: "event-1", correlationId: "event-1", idempotencyKey: "event-1" });
		const computer = _event("opencrane.conversation-computer.v1", { computer: { state: "cold", leaseGeneration: 1 }, lease: null }, { siloId: "silo-1", computerId: "computer-1", conversationId: "conversation-1", agentIdentityId: "identity-1", profileRevisionId: "profile-1", leaseId: null, leaseGeneration: null, leaseState: null });

		const receipts = await store.appendAtomic({ expectedHeads: [{ streamName: conversationStream, revision: HistoryExpectedRevisions.NoStream }, { streamName: computerStream, revision: HistoryExpectedRevisions.NoStream }], appends: [{ streamName: conversationStream, expectedRevision: HistoryExpectedRevisions.NoStream, events: [created] }, { streamName: computerStream, expectedRevision: HistoryExpectedRevisions.NoStream, events: [computer] }] });

		expect(receipts).toHaveLength(2);
	});

	it("appends one message and its activation request together, then refuses the same heads a second time", async function ()
	{
		// Mirrors `appendWithActivation` in libs/backend/server/conversations/main/src/conversation-history-authority.ts.
		const conversationStream = _stream("conversation");
		const queueStream = _stream("computer-activations");
		await store.append({ streamName: conversationStream, expectedRevision: HistoryExpectedRevisions.NoStream, events: [_event("opencrane.conversation-created.v1", { genesis: {} })] });
		const message = _event("opencrane.conversation-entry.v1", { entry: { position: "1" } }, { siloId: "silo-1", conversationId: "conversation-1", causationId: "source-1", correlationId: "request-1", idempotencyKey: "key-1" });
		const activation = _event("opencrane.computer.activation-requested.v1", { siloId: "silo-1", computerId: "computer-1", conversationId: "conversation-1", generation: 1 }, { causationId: message.id, correlationId: "request-1", idempotencyKey: "key-1" });
		const command = { expectedHeads: [{ streamName: conversationStream, revision: 0n }, { streamName: queueStream, revision: HistoryExpectedRevisions.NoStream }], appends: [{ streamName: conversationStream, expectedRevision: 0n, events: [message] }, { streamName: queueStream, expectedRevision: HistoryExpectedRevisions.NoStream, events: [activation] }] };

		const receipts = await store.appendAtomic(command);
		// The server treats a byte-identical retry (same event ids at the same heads) as already done.
		expect(await store.appendAtomic(command)).toEqual(receipts);
		// A different write against the now-stale heads must be refused.
		const freshMessage = _event(message.type, message.data, message.metadata);
		const freshActivation = _event(activation.type, activation.data, activation.metadata);
		const stale = { ...command, appends: command.appends.map((append, index) => ({ ...append, events: [index === 0 ? freshMessage : freshActivation] })) };
		const retried = await _staleHeadConflict(store.appendAtomic(stale));

		expect(receipts).toEqual(expect.arrayContaining([{ streamName: conversationStream, revision: 1n }, { streamName: queueStream, revision: 0n }]));
		expect([conversationStream, queueStream]).toContain(retried.streamName);
		expect(await store.readHead(conversationStream)).toEqual({ streamName: conversationStream, revision: 1n });
		expect(await store.readHead(queueStream)).toEqual({ streamName: queueStream, revision: 0n });
	});

	it("rolls the whole atomic append back when only the activation queue head is stale", async function ()
	{
		const conversationStream = _stream("conversation");
		const queueStream = _stream("computer-activations");
		await store.append({ streamName: conversationStream, expectedRevision: HistoryExpectedRevisions.NoStream, events: [_event("opencrane.conversation-created.v1", { genesis: {} })] });
		await store.append({ streamName: queueStream, expectedRevision: HistoryExpectedRevisions.NoStream, events: [_event("opencrane.computer.activation-requested.v1", { computerId: "computer-0" })] });

		// The writer read the queue before that earlier activation landed, so its no-stream check is stale.
		const conflict = await _staleHeadConflict(store.appendAtomic({ expectedHeads: [{ streamName: conversationStream, revision: 0n }, { streamName: queueStream, revision: HistoryExpectedRevisions.NoStream }], appends: [{ streamName: conversationStream, expectedRevision: 0n, events: [_event("opencrane.conversation-entry.v1", { entry: {} })] }, { streamName: queueStream, expectedRevision: HistoryExpectedRevisions.NoStream, events: [_event("opencrane.computer.activation-requested.v1", { computerId: "computer-1" })] }] }));

		expect(conflict.streamName).toBe(queueStream);
		expect(await store.readHead(conversationStream)).toEqual({ streamName: conversationStream, revision: 0n });
		expect(await store.readHead(queueStream)).toEqual({ streamName: queueStream, revision: 0n });
	});

	it("rolls the whole atomic append back when only the conversation head is stale", async function ()
	{
		const conversationStream = _stream("conversation");
		const queueStream = _stream("computer-activations");
		await store.append({ streamName: conversationStream, expectedRevision: HistoryExpectedRevisions.NoStream, events: [_event("opencrane.conversation-created.v1", { genesis: {} }), _event("opencrane.conversation-entry.v1", { entry: { position: "1" } })] });

		const conflict = await _staleHeadConflict(store.appendAtomic({ expectedHeads: [{ streamName: conversationStream, revision: 0n }, { streamName: queueStream, revision: HistoryExpectedRevisions.NoStream }], appends: [{ streamName: conversationStream, expectedRevision: 0n, events: [_event("opencrane.conversation-entry.v1", { entry: {} })] }, { streamName: queueStream, expectedRevision: HistoryExpectedRevisions.NoStream, events: [_event("opencrane.computer.activation-requested.v1", { computerId: "computer-1" })] }] }));

		expect(conflict.streamName).toBe(conversationStream);
		expect(await store.readHead(conversationStream)).toEqual({ streamName: conversationStream, revision: 1n });
		expect(await _streamExists(client, queueStream)).toBe(false);
	});

	it("streams existing and live appends to a catch-up subscriber and ends the iteration on close", async function ()
	{
		const streamName = _stream("conversation");
		const first = _event("opencrane.conversation-created.v1", { genesis: {} });
		await store.append({ streamName, expectedRevision: HistoryExpectedRevisions.NoStream, events: [first] });
		const subscription = await store.subscribe({ streamName });
		const iterator = subscription.events[Symbol.asyncIterator]();
		const second = _event("opencrane.conversation-entry.v1", { entry: { position: "1" } });
		const third = _event("opencrane.conversation-entry.v1", { entry: { position: "2" } });

		const caughtUp = await _next(iterator, "the subscriber never received the existing event");
		await store.append({ streamName, expectedRevision: 0n, events: [second, third] });
		const live = [await _next(iterator, "the subscriber never received the first live event"), await _next(iterator, "the subscriber never received the second live event")];
		await subscription.close();
		const afterClose = await _within(iterator.next(), "the subscription did not end after close");

		expect(_shape(caughtUp)).toEqual({ ...first, streamName, revision: 0n });
		expect(live.map(_shape)).toEqual([{ ...second, streamName, revision: 1n }, { ...third, streamName, revision: 2n }]);
		expect(afterClose.done).toBe(true);
	});

	it("starts a subscription at the requested revision", async function ()
	{
		const streamName = _stream("conversation");
		const events = [_event("opencrane.conversation-created.v1", { genesis: {} }), _event("opencrane.conversation-entry.v1", { entry: { position: "1" } }), _event("opencrane.conversation-entry.v1", { entry: { position: "2" } })];
		await store.append({ streamName, expectedRevision: HistoryExpectedRevisions.NoStream, events });
		const subscription = await store.subscribe({ streamName, fromRevision: 1n });
		const iterator = subscription.events[Symbol.asyncIterator]();

		const delivered = await _next(iterator, "the subscriber never received an event from the requested revision");
		await subscription.close();

		// HistoryReadRequest promises the same inclusive cursor for reads and subscriptions.
		expect(delivered.revision).toBe(1n);
		expect(delivered.id).toBe(events[1]?.id);
	});

	describe("persistent activation consumer group", function ()
	{
		const queueStream = _stream("computer-activations");

		beforeAll(async function _provisionGroup()
		{
			await client.createPersistentSubscriptionToStream(queueStream, _ACTIVATION_GROUP, _activationGroupSettings());
		});

		afterAll(async function _removeGroup()
		{
			await client.deletePersistentSubscriptionToStream(queueStream, _ACTIVATION_GROUP);
		});

		it("delivers an activation, redelivers it after a retry, and moves on after acknowledgement", async function ()
		{
			const activation = _event("opencrane.computer.activation-requested.v1", { computerId: "computer-1", generation: 1 }, { causationId: "message-1", correlationId: "request-1", idempotencyKey: "key-1" });
			await store.append({ streamName: queueStream, expectedRevision: HistoryExpectedRevisions.NoStream, events: [activation] });
			const consumer = await store.subscribePersistent({ streamName: queueStream, groupName: _ACTIVATION_GROUP });
			const iterator = consumer.events[Symbol.asyncIterator]();

			const first = await _next(iterator, "the group never delivered the appended activation");
			await consumer.retry(first, "transient failure");
			const second = await _next(iterator, "the group did not redeliver the activation after nack-retry");
			await consumer.acknowledge(second);
			await consumer.close();

			expect(_shape(first)).toEqual({ ...activation, streamName: queueStream, revision: 0n });
			expect(first.retryCount).toBe(0);
			expect(second.id).toBe(activation.id);
			expect(second.retryCount).toBe(1);
			await expect(consumer.acknowledge(second)).rejects.toThrow("does not hold delivery");
		});

		it("parks a poison activation and replays the parked queue back into live delivery", async function ()
		{
			const poison = _event("opencrane.computer.activation-requested.v1", { computerId: "computer-2", generation: 1 });
			await store.append({ streamName: queueStream, expectedRevision: 0n, events: [poison] });
			const consumer = await store.subscribePersistent({ streamName: queueStream, groupName: _ACTIVATION_GROUP });
			const iterator = consumer.events[Symbol.asyncIterator]();

			const delivered = await _next(iterator, "the group never delivered the poison activation");
			await consumer.park(delivered, "poison payload");
			await _eventually(async function _parked()
			{
				const info = await client.getPersistentSubscriptionToStreamInfo(queueStream, _ACTIVATION_GROUP);
				return info.stats.parkedMessageCount === 1n;
			}, "KurrentDB never reported the parked activation");
			await store.replayParked({ streamName: queueStream, groupName: _ACTIVATION_GROUP });
			const replayed = await _next(iterator, "the group did not redeliver the parked activation after replay");
			await consumer.acknowledge(replayed);
			await consumer.close();

			expect(delivered.id).toBe(poison.id);
			expect(replayed.id).toBe(poison.id);
			await _eventually(async function _drained()
			{
				const info = await client.getPersistentSubscriptionToStreamInfo(queueStream, _ACTIVATION_GROUP);
				return info.stats.parkedMessageCount === 0n;
			}, "KurrentDB still reports a parked activation after replay and acknowledgement");
		});

		it("admits one consumer at a time because the group caps maxSubscriberCount at one", async function ()
		{
			const holder = await store.subscribePersistent({ streamName: queueStream, groupName: _ACTIVATION_GROUP });
			const holderIterator = holder.events[Symbol.asyncIterator]();
			const holderWaiting = holderIterator.next();
			await _eventually(async function _connected()
			{
				const info = await client.getPersistentSubscriptionToStreamInfo(queueStream, _ACTIVATION_GROUP);
				return info.connections.length === 1;
			}, "the first consumer never appeared as a group connection");

			// The client only reports a refused slot once the caller starts reading deliveries.
			const rival = await store.subscribePersistent({ streamName: queueStream, groupName: _ACTIVATION_GROUP });
			const rivalIterator = rival.events[Symbol.asyncIterator]();
			const refusal = _within(rivalIterator.next(), "the second consumer was neither admitted nor refused");
			await expect(refusal).rejects.toBeInstanceOf(PersistentSubscriptionMaximumSubscribersReachedError);
			await holder.close();
			// A delivery left over from an earlier group test may reach the holder before the close lands;
			// acknowledge anything it received and read on until the iteration reports its end.
			let holderEnded = await _within(holderWaiting, "the first consumer did not end after close");
			while (!holderEnded.done)
			{
				await holder.acknowledge(holderEnded.value);
				holderEnded = await _within(holderIterator.next(), "the first consumer did not end after close");
			}
			await _eventually(async function _released()
			{
				const info = await client.getPersistentSubscriptionToStreamInfo(queueStream, _ACTIVATION_GROUP);
				return info.connections.length === 0;
			}, "the closed consumer still holds the group slot");

			// A successor takes the freed slot and receives the next activation.
			const successor = await store.subscribePersistent({ streamName: queueStream, groupName: _ACTIVATION_GROUP });
			const successorIterator = successor.events[Symbol.asyncIterator]();
			const activation = _event("opencrane.computer.activation-requested.v1", { computerId: "computer-3", generation: 1 });
			await store.append({ streamName: queueStream, expectedRevision: 1n, events: [activation] });
			const delivered: HistoryPersistentRecordedEvent = await _next(successorIterator, "the successor consumer never received the new activation");
			await successor.acknowledge(delivered);
			await successor.close();

			expect(holderEnded.done).toBe(true);
			expect(delivered.id).toBe(activation.id);
		});
	});
});
