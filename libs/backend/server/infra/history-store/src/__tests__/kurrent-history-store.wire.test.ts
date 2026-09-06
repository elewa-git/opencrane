import { StreamNotFoundError } from "@kurrent/kurrentdb-client";
import { describe, expect, it, vi } from "vitest";

import { HistoryExpectedRevisions } from "../history-store.types";
import { _KurrentHistoryStore } from "../kurrent-history-store";

/** Builds the client's stream-not-found error without a gRPC status object, keeping only its identity. */
function _StreamNotFound(): StreamNotFoundError
{
	return Object.assign(Object.create(StreamNotFoundError.prototype) as StreamNotFoundError, { message: "stream not found" });
}

/** Builds a client double whose readStream fails the way the real client reports an unwritten stream. */
function _MissingStreamClient()
{
	return {
		readStream: vi.fn(function _ReadStream() { return { async *[Symbol.asyncIterator]() { throw _StreamNotFound(); } }; }),
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
		const store = new _KurrentHistoryStore(_MissingStreamClient() as never);
		await expect(store.readHead("computer-activations-silo-1")).resolves.toEqual({ streamName: "computer-activations-silo-1", revision: null });
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
