import { PassThrough } from "node:stream";

import { AccessDeniedError, StreamDeletedError, StreamNotFoundError, UnavailableError } from "@kurrent/kurrentdb-client";
import { describe, expect, it, vi } from "vitest";

import { HistoryExpectedRevisions } from "../history-store.types";
import { _KurrentHistoryStore } from "../kurrent-history-store";

/** Reports the same failure through the client's finite iterator and catch-up subscription. */
function _FailingStreamClient(error: Error = new StreamNotFoundError(undefined, "unwritten-stream"))
{
	return {
		readStream: vi.fn(function _ReadStream() { return { async *[Symbol.asyncIterator]() { throw error; } }; }),
		subscribeToStream: vi.fn(function _Subscribe()
		{
			const events = Object.assign(new PassThrough({ objectMode: true }), { unsubscribe: vi.fn().mockResolvedValue(undefined) });
			queueMicrotask(function _Fail() { events.emit("error", error); });
			return events;
		}),
	};
}

/** Captures the records a client would send so a test can inspect their wire metadata. */
function _RecordingClient()
{
	const appendToStream = vi.fn(async function _Append() { return { nextExpectedRevision: 0n }; });
	const appendRecords = vi.fn(async function _AppendRecords() { return { responses: [{ streamName: "conversation-1", revision: 0n }] }; });
	return { client: { appendToStream, appendRecords }, appendToStream, appendRecords };
}

describe("_KurrentHistoryStore wire shape", function _Suite()
{
	it("reports a stream the client has never written as a null head", async function _MissingHead()
	{
		const store = new _KurrentHistoryStore(_FailingStreamClient() as never);
		await expect(store.readHead("computer-activations-silo-1")).resolves.toEqual({ streamName: "computer-activations-silo-1", revision: null });
	});

	it("finishes a never-written stream read without yielding an event", async function _MissingStream()
	{
		const store = new _KurrentHistoryStore(_FailingStreamClient() as never);
		await expect(store.readStream({ streamName: "opencrane-silo" })[Symbol.asyncIterator]().next()).resolves.toEqual({ value: undefined, done: true });
	});

	it("finishes and closes a never-written bounded stream read", async function _MissingBoundedStream()
	{
		const client = _FailingStreamClient();
		const store = new _KurrentHistoryStore(client as never);
		await expect(store.readStream({ streamName: "unwritten-stream", maxCount: 1 })[Symbol.asyncIterator]().next()).resolves.toEqual({ value: undefined, done: true });
		const subscription = client.subscribeToStream.mock.results[0]!.value;
		expect(subscription.unsubscribe).toHaveBeenCalledOnce();
		expect(subscription.destroyed).toBe(true);
	});

	it.each([
		new AccessDeniedError(undefined, "access denied"),
		new UnavailableError(undefined, "transport unavailable"),
		StreamDeletedError.fromStreamName("deleted-stream"),
		Object.assign(new Error("lookalike missing-stream failure"), { name: "StreamNotFoundError" }),
	])("preserves %s on finite and bounded reads", async function _OtherReadFailure(error)
	{
		const store = new _KurrentHistoryStore(_FailingStreamClient(error) as never);
		await expect(store.readStream({ streamName: "failed-stream" })[Symbol.asyncIterator]().next()).rejects.toBe(error);
		await expect(store.readStream({ streamName: "failed-stream", maxCount: 1 })[Symbol.asyncIterator]().next()).rejects.toBe(error);
	});

	it("preserves cancellation even when its reason is a missing-stream error", async function _CancelledMissingRead()
	{
		const stop = new AbortController();
		const reason = new StreamNotFoundError(undefined, "cancellation-reason");
		const store = new _KurrentHistoryStore(_FailingStreamClient() as never);
		const pending = store.readStream({ streamName: "unwritten-stream", maxCount: 1, signal: stop.signal })[Symbol.asyncIterator]().next();
		stop.abort(reason);
		await expect(pending).rejects.toBe(reason);
	});

	it("flattens metadata to strings and drops empty fields on both append paths", async function _FlatMetadata()
	{
		const recording = _RecordingClient();
		const store = new _KurrentHistoryStore(recording.client as never);
		const event = { id: "8e0e2498-819f-4339-8d78-4f4c7377e20b", type: "opencrane.conversation-computer.v1", data: { computer: { state: "cold" } }, metadata: { siloId: "silo-1", leaseGeneration: 1, leaseId: null, warm: false } };
		await store.append({ streamName: "conversation-computer-1", expectedRevision: HistoryExpectedRevisions.NoStream, events: [event] });
		await store.appendAtomic({ expectedHeads: [{ streamName: "conversation-computer-1", revision: HistoryExpectedRevisions.NoStream }], appends: [{ streamName: "conversation-computer-1", expectedRevision: HistoryExpectedRevisions.NoStream, events: [event] }] });
		const expected = { siloId: "silo-1", leaseGeneration: "1", warm: "false" };
		const appended = recording.appendToStream.mock.calls[0] as unknown as [string, ReadonlyArray<{ readonly metadata: unknown }>];
		const recorded = recording.appendRecords.mock.calls[0] as unknown as [ReadonlyArray<{ readonly record: { readonly metadata: unknown } }>];
		expect(appended[1][0]?.metadata).toEqual(expected);
		expect(recorded[0][0]?.record.metadata).toEqual(expected);
	});

	it("refuses nested metadata instead of mangling it", async function _NestedMetadata()
	{
		const recording = _RecordingClient();
		const store = new _KurrentHistoryStore(recording.client as never);
		const event = { id: "8e0e2498-819f-4339-8d78-4f4c7377e20b", type: "opencrane.test.v1", data: {}, metadata: { nested: { inner: true } } as never };
		await expect(store.append({ streamName: "conversation-1", expectedRevision: HistoryExpectedRevisions.NoStream, events: [event] })).rejects.toThrow("metadata 'nested' must be a flat string");
		expect(recording.appendToStream).not.toHaveBeenCalled();
	});
});
