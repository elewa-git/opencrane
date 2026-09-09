import { KurrentDBClient } from "@kurrent/kurrentdb-client";
import { ReadResp } from "@kurrent/kurrentdb-client/generated/kurrentdb/protocols/v1/streams_pb";
import { StreamIdentifier, UUID } from "@kurrent/kurrentdb-client/generated/kurrentdb/protocols/v1/shared_pb";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";

import { HistoryExpectedRevisions } from "../history-store.types";
import { _KurrentHistoryStore } from "../kurrent-history-store";

/** Builds the real protobuf input consumed by the installed SDK's subscription transform. */
function _GrpcEvent(revision: number): ReadResp
{
	const event = new ReadResp.ReadEvent.RecordedEvent();
	event.setId(new UUID().setString("31c1f1dc-0010-4f13-9c2f-d3841ffd6651"));
	event.setStreamIdentifier(new StreamIdentifier().setStreamName(Buffer.from("conversation-1")));
	event.setStreamRevision(String(revision));
	event.setData(Buffer.from("{}"));
	event.setCustomMetadata(Buffer.from("{}"));
	event.getMetadataMap().set("content-type", "application/json");
	event.getMetadataMap().set("type", "test");
	event.getMetadataMap().set("created", "0");
	return new ReadResp().setEvent(new ReadResp.ReadEvent().setEvent(event));
}

describe("_KurrentHistoryStore", function ()
{
	it("rejects an incomplete catch-up if transport ends before count or caughtUp", async function ()
	{
		const events = Object.assign(new PassThrough({ objectMode: true }), { unsubscribe: vi.fn().mockResolvedValue(undefined) });
		const store = new _KurrentHistoryStore({ subscribeToStream: vi.fn().mockReturnValue(events) } as unknown as KurrentDBClient);
		const pending = store.readStream({ streamName: "conversation-1", maxCount: 2 })[Symbol.asyncIterator]().next();
		events.end();
		await expect(pending).rejects.toThrow("ended before reaching its boundary");
		expect(events.unsubscribe).toHaveBeenCalledOnce();
	});

	it("does not yield another already-buffered event after cancellation", async function ()
	{
		const events = Object.assign(new PassThrough({ objectMode: true }), { unsubscribe: vi.fn().mockResolvedValue(undefined) });
		const store = new _KurrentHistoryStore({ subscribeToStream: vi.fn().mockReturnValue(events) } as unknown as KurrentDBClient);
		const stop = new AbortController();
		const iterator = store.readStream({ streamName: "conversation-1", maxCount: 2, signal: stop.signal })[Symbol.asyncIterator]();
		const pending = iterator.next();
		for (const revision of [0n, 1n])
			events.write({ event: { streamId: "conversation-1", id: "entry-1", type: "test", data: {}, metadata: {}, revision, created: new Date() } });
		expect((await pending).value?.revision).toBe(0n);
		stop.abort();
		await expect(iterator.next()).rejects.toThrow();
		expect(events.unsubscribe).toHaveBeenCalledOnce();
	});

	it("retains every buffered event preceding the installed SDK caughtUp notification", async function ()
	{
		const grpc = Object.assign(new PassThrough({ objectMode: true }), { cancel: vi.fn(function _Cancel() { grpc.end(); }) });
		const client = { subscribeToStream: KurrentDBClient.prototype.subscribeToStream.bind({ GRPCStreamCreator: function _Create() { return async function _Stream() { return grpc; }; } } as never) };
		const store = new _KurrentHistoryStore(client as unknown as KurrentDBClient);
		const received: bigint[] = [];
		const collecting = (async function _Collect() { for await (const event of store.readStream({ streamName: "conversation-1", maxCount: 3 })) received.push(event.revision); })();
		grpc.write(_GrpcEvent(0));
		grpc.write(_GrpcEvent(1));
		grpc.write(new ReadResp().setCaughtUp(new ReadResp.CaughtUp()));
		await collecting;
		expect(received).toEqual([0n, 1n]);
		expect(grpc.cancel).toHaveBeenCalledOnce();
	});

	it("propagates the installed subscription's one-object backpressure to its producer", async function ()
	{
		const grpc = Object.assign(new PassThrough({ objectMode: true }), { cancel: vi.fn(function _Cancel() { grpc.end(); }) });
		const subscription = KurrentDBClient.prototype.subscribeToStream.call({ GRPCStreamCreator: function _Create() { return async function _Stream() { return grpc; }; } } as never, "conversation-1", {}, { highWaterMark: 1 });
		await Promise.resolve();
		let accepted = 0;
		for (; accepted < 100; accepted += 1)
			if (!grpc.write(_GrpcEvent(accepted)))
				break;
		expect(accepted).toBeLessThan(64);
		expect(subscription.readableLength).toBeLessThanOrEqual(1);
		await subscription.unsubscribe();
		subscription.destroy();
		grpc.destroy();
	});

	it("uses the installed SDK caughtUp boundary and cancels its real subscription transport", async function ()
	{
		const grpc = Object.assign(new PassThrough({ objectMode: true }), { cancel: vi.fn(function _Cancel() { grpc.end(); }) });
		const client = { subscribeToStream: KurrentDBClient.prototype.subscribeToStream.bind({ GRPCStreamCreator: function _Create() { return async function _Stream() { return grpc; }; } } as never) };
		const store = new _KurrentHistoryStore(client as unknown as KurrentDBClient);
		const iterator = store.readStream({ streamName: "conversation-1", fromRevision: 5n, maxCount: 1 })[Symbol.asyncIterator]();
		const pending = iterator.next();
		grpc.write(new ReadResp().setCaughtUp(new ReadResp.CaughtUp()));
		expect(await pending).toEqual({ value: undefined, done: true });
		expect(grpc.cancel).toHaveBeenCalledOnce();
	});

	it("stops a bounded read at maxCount even if catch-up has not finished", async function ()
	{
		const events = Object.assign(new PassThrough({ objectMode: true }), { unsubscribe: vi.fn().mockResolvedValue(undefined) });
		const store = new _KurrentHistoryStore({ subscribeToStream: vi.fn().mockReturnValue(events) } as unknown as KurrentDBClient);
		const pending = store.readStream({ streamName: "conversation-1", maxCount: 1 })[Symbol.asyncIterator]().next();
		events.write({ event: { streamId: "conversation-1", id: "entry-1", type: "test", data: {}, metadata: {}, revision: 0n, created: new Date() } });
		expect((await pending).value?.revision).toBe(0n);
		expect(events.unsubscribe).toHaveBeenCalledOnce();
		expect(events.destroyed).toBe(true);
	});

	it("cancels a pending finite read upstream when its consumer aborts", async function ()
	{
		const stream = Object.assign(new PassThrough({ objectMode: true }), { unsubscribe: vi.fn().mockResolvedValue(undefined) });
		const subscribeToStream = vi.fn().mockReturnValue(stream);
		const store = new _KurrentHistoryStore({ subscribeToStream } as unknown as KurrentDBClient);
		const stop = new AbortController();
		const pending = store.readStream({ streamName: "conversation-1", fromRevision: 5n, maxCount: 2, signal: stop.signal })[Symbol.asyncIterator]().next();
		stop.abort();
		await expect(pending).rejects.toThrow();
		expect(subscribeToStream).toHaveBeenCalledWith("conversation-1", { fromRevision: 4n }, { highWaterMark: 1 });
		expect(stream.unsubscribe).toHaveBeenCalledOnce();
		expect(stream.destroyed).toBe(true);
	});

	it("does not open a finite read after cancellation", async function ()
	{
		const readStream = vi.fn();
		const store = new _KurrentHistoryStore({ readStream } as unknown as KurrentDBClient);
		const stop = new AbortController();
		stop.abort();
		await expect(store.readStream({ streamName: "conversation-1", signal: stop.signal })[Symbol.asyncIterator]().next()).rejects.toThrow();
		expect(readStream).not.toHaveBeenCalled();
	});

	it("keeps a no-stream append conditional and returns Kurrent's committed revision", async function ()
	{
		const appendToStream = vi.fn().mockResolvedValue({ nextExpectedRevision: 4n });
		const client = { appendToStream } as unknown as KurrentDBClient;
		const store = new _KurrentHistoryStore(client);

		const receipt = await store.append({ streamName: "conversation-1", expectedRevision: HistoryExpectedRevisions.NoStream, events: [{ id: "b9d6434b-a3a9-4478-a78f-cf08a479c7f1", type: "conversation.created.v1", data: { conversationId: "1" }, metadata: {} }] });

		expect(appendToStream).toHaveBeenCalledWith("conversation-1", expect.any(Array), { streamState: "no_stream" });
		expect(receipt).toEqual({ streamName: "conversation-1", revision: 4n });
	});

	it("submits every expected head with cross-stream records in one Kurrent append", async function ()
	{
		const appendRecords = vi.fn().mockResolvedValue({ responses: [{ streamName: "conversation-1", revision: 7n }, { streamName: "run-1", revision: 2n }] });
		const client = { appendRecords } as unknown as KurrentDBClient;
		const store = new _KurrentHistoryStore(client);

		const receipts = await store.appendAtomic({ expectedHeads: [{ streamName: "conversation-1", revision: 6n }, { streamName: "run-1", revision: HistoryExpectedRevisions.NoStream }], appends: [{ streamName: "conversation-1", expectedRevision: 6n, events: [{ id: "21331a84-1844-4ba3-8e94-3a4f55204ccb", type: "conversation.message.v1", data: { entryId: "1" }, metadata: {} }] }, { streamName: "run-1", expectedRevision: HistoryExpectedRevisions.NoStream, events: [{ id: "71b5fef0-f43b-4fb8-9a76-724460ca84d4", type: "run.started.v1", data: { runId: "1" }, metadata: {} }] }] });

		expect(appendRecords).toHaveBeenCalledOnce();
		expect(receipts).toEqual([{ streamName: "conversation-1", revision: 7n }, { streamName: "run-1", revision: 2n }]);
	});

	it("rejects a cross-stream append whose declared revision has no matching head", async function ()
	{
		const appendRecords = vi.fn();
		const client = { appendRecords } as unknown as KurrentDBClient;
		const store = new _KurrentHistoryStore(client);

		await expect(store.appendAtomic({ expectedHeads: [], appends: [{ streamName: "conversation-1", expectedRevision: HistoryExpectedRevisions.NoStream, events: [{ id: "8e0e2498-819f-4339-8d78-4f4c7377e20b", type: "conversation.created.v1", data: { conversationId: "1" }, metadata: {} }] }] })).rejects.toThrow("omits 'conversation-1' expected revision");

		expect(appendRecords).not.toHaveBeenCalled();
	});

	it("acknowledges, retries, and parks only a delivered persistent event", async function ()
	{
		const delivery = { event: { id: "8e0e2498-819f-4339-8d78-4f4c7377e20b", type: "computer.activation-requested.v1", data: { computerId: "computer-1" }, metadata: {}, streamId: "computer-computer-1", revision: 4n, created: new Date("2026-08-31T00:00:00.000Z") }, retryCount: 2 };
		const ack = vi.fn().mockResolvedValue(undefined);
		const nack = vi.fn().mockResolvedValue(undefined);
		const unsubscribe = vi.fn().mockResolvedValue(undefined);
		const subscription = { ack, nack, unsubscribe, async *[Symbol.asyncIterator]() { yield delivery; } };
		const subscribeToPersistentSubscriptionToStream = vi.fn().mockReturnValue(subscription);
		const store = new _KurrentHistoryStore({ subscribeToPersistentSubscriptionToStream } as unknown as KurrentDBClient);
		const consumer = await store.subscribePersistent({ streamName: "computer-computer-1", groupName: "conversation-computer-activation" });
		const iterator = consumer.events[Symbol.asyncIterator]();
		const next = await iterator.next();
		if (next.done)
			throw new Error("persistent test delivery was not yielded");

		expect(next.value).toMatchObject({ id: delivery.event.id, retryCount: 2 });
		await consumer.retry(next.value, "transient failure");
		expect(nack).toHaveBeenCalledWith("retry", "transient failure", delivery);
		await expect(consumer.acknowledge(next.value)).rejects.toThrow("does not hold delivery");
		await consumer.close();
		expect(unsubscribe).toHaveBeenCalledOnce();
	});

	it("uses the newest opaque handle when KurrentDB redelivers an event", async function ()
	{
		const firstDelivery = { event: { id: "8e0e2498-819f-4339-8d78-4f4c7377e20b", type: "computer.activation-requested.v1", data: {}, metadata: {}, streamId: "computer-computer-1", revision: 4n, created: new Date("2026-08-31T00:00:00.000Z") }, retryCount: 0 };
		const secondDelivery = { ...firstDelivery, retryCount: 1 };
		const ack = vi.fn().mockResolvedValue(undefined);
		const subscription = { ack, nack: vi.fn(), unsubscribe: vi.fn(), async *[Symbol.asyncIterator]() { yield firstDelivery; yield secondDelivery; } };
		const store = new _KurrentHistoryStore({ subscribeToPersistentSubscriptionToStream: vi.fn().mockReturnValue(subscription) } as unknown as KurrentDBClient);
		const consumer = await store.subscribePersistent({ streamName: "computer-computer-1", groupName: "conversation-computer-activation" });
		const iterator = consumer.events[Symbol.asyncIterator]();
		const first = await iterator.next();
		const second = await iterator.next();
		if (first.done || second.done)
			throw new Error("persistent redelivery was not yielded");

		await consumer.acknowledge(first.value);
		expect(ack).toHaveBeenCalledWith(secondDelivery);
	});

	it("restores a failed terminal delivery and rejects a concurrent second action", async function ()
	{
		let releaseAcknowledgement: (() => void) | undefined;
		const waitForAcknowledgement = new Promise<void>(function (resolve) { releaseAcknowledgement = resolve; });
		const delivery = { event: { id: "8e0e2498-819f-4339-8d78-4f4c7377e20b", type: "computer.activation-requested.v1", data: {}, metadata: {}, streamId: "computer-computer-1", revision: 4n, created: new Date("2026-08-31T00:00:00.000Z") }, retryCount: 0 };
		const ack = vi.fn().mockRejectedValueOnce(new Error("transport failure")).mockReturnValueOnce(waitForAcknowledgement);
		const subscription = { ack, nack: vi.fn(), unsubscribe: vi.fn(), async *[Symbol.asyncIterator]() { yield delivery; } };
		const store = new _KurrentHistoryStore({ subscribeToPersistentSubscriptionToStream: vi.fn().mockReturnValue(subscription) } as unknown as KurrentDBClient);
		const consumer = await store.subscribePersistent({ streamName: "computer-computer-1", groupName: "conversation-computer-activation" });
		const next = await consumer.events[Symbol.asyncIterator]().next();
		if (next.done)
			throw new Error("persistent delivery was not yielded");

		await expect(consumer.acknowledge(next.value)).rejects.toThrow("transport failure");
		const acknowledged = consumer.acknowledge(next.value);
		await expect(consumer.park(next.value, "poison event")).rejects.toThrow("does not hold delivery");
		releaseAcknowledgement?.();
		await acknowledged;
	});
});
