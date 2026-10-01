import { describe, expect, it, vi } from "vitest";

import type { HistoryAppend, HistoryReadRequest, HistoryRecordedEvent } from "@opencrane/backend/server/infra/history-store";

import { BoundConversationWriter } from "../bound-conversation-writer";
import type { BoundConversationWriterBinding } from "../bound-conversation-writer.types";

/** Keep every server-owned binding coordinate fixed while exercising recovery. */
const _BINDING: BoundConversationWriterBinding = { siloId: "silo-1", conversationId: "conversation-1", computerId: "computer-1", leaseGeneration: 4, agentIdentityId: "identity-1", agentServiceId: "service-1", agentName: "Archive", agentAvatarArtifactRevisionId: null, runId: "run-1", expectedRevision: 7n, maximumEntryBytes: 10_000 };
/** Supply only the computer's permitted draft fields. */
function _Draft()
{
	return { sourceCommandId: "31c1f1dc-0010-4f13-9c2f-d3841ffd6651", entry: { kind: "a2ui" as const, surfaceId: "surface-1", a2uiSchemaVersion: "0.8", operation: "remove" as const, payloadRef: null, payloadDigest: null, visibility: { audience: "conversation" as const }, causationId: "source-1", correlationId: "request-1" } };
}

/** Share bounded history between independent writer instances, retaining actual stored wire fields. */
function _Writer(maximumEntryBytes = _BINDING.maximumEntryBytes)
{
	const state = { event: null as HistoryRecordedEvent | null };
	const append = vi.fn(async function _Append(command: HistoryAppend)
	{
		state.event = { ...structuredClone(command.events[0]), streamName: command.streamName, revision: 8n, recordedAt: new Date() };
		return { streamName: command.streamName, revision: 8n };
	});
	const readStream = vi.fn(function _Read(request: HistoryReadRequest)
	{
		return (async function* _Events()
		{
			if (state.event !== null && request.fromRevision === 8n && request.maxCount === 1)
				yield structuredClone(state.event);
		})();
	});
	const assertMayAppend = vi.fn().mockResolvedValue(undefined);
	const assertMayUseVisibility = vi.fn().mockResolvedValue(undefined);
	const assertLeaseMayAppend = vi.fn().mockResolvedValue(undefined);
	const now = vi.fn().mockReturnValue(new Date("2026-09-08T22:00:00.000Z"));
	function _Restart() { return new BoundConversationWriter({ append, readStream }, { ..._BINDING, maximumEntryBytes }, { now }, { assertMayAppend }, { assertMayUseVisibility }, { assertMayAppend: assertLeaseMayAppend }); }
	return { writer: _Restart(), restart: _Restart, append, readStream, state, now, assertMayAppend, assertMayUseVisibility, assertLeaseMayAppend };
}

describe("BoundConversationWriter durable intent", function _Suite()
{
	it("prepares a complete wire envelope without appending and requires exact readback after append", async function _Prepares()
	{
		const f = _Writer();
		const intent = await f.writer.prepare(_Draft());
		expect(f.append).not.toHaveBeenCalled();
		expect(intent).toMatchObject({ streamName: "conversation-conversation-1", expectedRevision: "7", event: { id: _Draft().sourceCommandId, metadata: { computerId: "computer-1", leaseGeneration: "4" }, data: { entry: { position: "8", occurredAt: "2026-09-08T22:00:00.000Z", author: { kind: "agent", agentIdentityId: "identity-1" } } } } });
		expect(await f.writer.append(intent)).toEqual(intent.event.data.entry);
		expect(f.append).toHaveBeenCalledWith({ streamName: intent.streamName, expectedRevision: 7n, events: [intent.event] });
		expect(f.readStream).toHaveBeenCalledTimes(2);
		expect(f.readStream).toHaveBeenCalledWith({ streamName: intent.streamName, fromRevision: 8n, maxCount: 1 });
	});

	it("refuses a second preparation, second completed append and oversized entries", async function _SingleUse()
	{
		const f = _Writer();
		const intent = await f.writer.prepare(_Draft());
		await expect(f.writer.prepare(_Draft())).rejects.toThrow("single-use");
		await f.writer.append(intent);
		await expect(f.writer.append(intent)).rejects.toThrow("single-use");
		const small = _Writer(1);
		await expect(small.writer.prepare(_Draft())).rejects.toThrow("maximum byte size");
		expect(small.append).not.toHaveBeenCalled();
	});

	it.each(["lease", "visibility"])("rechecks current %s before a still-absent output can append", async function _CurrentAuthority(kind)
	{
		const f = _Writer();
		const intent = await f.writer.prepare(_Draft());
		const guard = kind === "lease" ? f.assertLeaseMayAppend : f.assertMayUseVisibility;
		guard.mockRejectedValueOnce(new Error("authority ended"));
		await expect(f.writer.append(intent)).rejects.toThrow("authority ended");
		expect(f.append).not.toHaveBeenCalled();
	});

	it("recovers an accepted append on a fresh writer with a different clock and no new authority grant", async function _ResponseLost()
	{
		const f = _Writer();
		const intent = await f.writer.prepare(_Draft());
		const write = f.append.getMockImplementation()!;
		f.append.mockImplementationOnce(async function _LoseResponse(command) { await write(command); throw new Error("response lost"); });
		await expect(f.writer.append(intent)).rejects.toThrow("response lost");
		f.now.mockReturnValue(new Date("2026-09-08T23:00:00.000Z"));
		f.assertLeaseMayAppend.mockRejectedValue(new Error("history no longer compiles"));
		expect(await f.restart().append(intent)).toEqual(intent.event.data.entry);
		expect(f.append).toHaveBeenCalledOnce();
		expect(f.now).toHaveBeenCalledOnce();
		expect(f.assertLeaseMayAppend).toHaveBeenCalledOnce();
	});

	it.each(["metadata", "data", "id", "type", "stream", "revision"])("rejects a same-ID acknowledgement with different stored %s", async function _Alias(field)
	{
		const f = _Writer();
		const intent = await f.writer.prepare(_Draft());
		const write = f.append.getMockImplementation()!;
		f.append.mockImplementationOnce(async function _AliasAcknowledgement(command)
		{
			const receipt = await write(command);
			const event = f.state.event!;
			const differences = { metadata: { ...event, metadata: { ...event.metadata, runId: "foreign-run" } }, data: { ...event, data: { entry: { ...intent.event.data.entry, occurredAt: "2026-09-08T23:00:00.000Z" } } }, id: { ...event, id: "different-id" }, type: { ...event, type: "different-type" }, stream: { ...event, streamName: "different-stream" }, revision: { ...event, revision: 9n } };
			f.state.event = differences[field as keyof typeof differences];
			return receipt;
		});
		await expect(f.writer.append(intent)).rejects.toThrow("different history");
	});

	it("detaches the draft and saved intent before awaited policy checks", async function _DetachedInput()
	{
		const f = _Writer();
		const draft = _Draft();
		f.assertMayAppend.mockImplementationOnce(async function _MutateDraft() { draft.entry.surfaceId = "changed-draft"; });
		const intent = await f.writer.prepare(draft);
		expect(intent.event.data.entry).toMatchObject({ surfaceId: "surface-1" });
		f.assertMayUseVisibility.mockImplementationOnce(async function _MutateIntent() { Object.assign(intent.event.data.entry, { surfaceId: "changed-intent" }); });
		await f.writer.append(intent);
		expect(f.state.event?.data.entry).toMatchObject({ surfaceId: "surface-1" });
	});
});
