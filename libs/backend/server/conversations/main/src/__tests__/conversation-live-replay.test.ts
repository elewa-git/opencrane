import { describe, expect, it, vi } from "vitest";

import { __StreamConversationLiveReplay } from "../conversation-live-replay.js";
import { ConversationLiveReplayOutcomes } from "../conversation-live-replay.types.js";
import { ConversationReplayReadStatuses } from "../replay-reader.types.js";

/** Deterministic clock that advances only when the live reader waits. */
function _Clock()
{
	let now = 0;
	return { now: function _Now() { return now; }, wait: async function _Wait(milliseconds: number) { now += milliseconds; } };
}

function _Limits(pageSize = 10)
{
	return { pageSize, pollMilliseconds: 25, heartbeatMilliseconds: 50, maximumDurationMilliseconds: 50 };
}

function _Row()
{
	return { cursor: "legacy-row-cursor", conversationId: "conversation-1", runId: null, position: "1", type: "conversation.message", payload: { messageId: "message-1", role: "user", state: "completed", blocks: [{ id: "block-1", kind: "text", value: "hello" }] }, occurredAt: "2026-08-11T00:00:00.000Z" };
}

describe("live conversation replay", function _Suite()
{
	it("resumes inside a multi-frame ordinary message without a gap or duplicate", async function _ResumesSubframe()
	{
		const output: string[] = [];
		const readAuthorized = vi.fn(async function _Read()
		{
			return { status: ConversationReplayReadStatuses.Authorized, rows: [_Row()] };
		});
		const abort = new AbortController();
		const result = await __StreamConversationLiveReplay({ repository: { readAuthorized }, clock: _Clock(), limits: _Limits() }, { open: vi.fn(), write: function _Write(value): boolean { output.push(value); return true; }, drain: vi.fn() }, { conversationId: "conversation-1", siloId: "silo-1", subjectId: "user-1", cursor: { conversationId: "conversation-1", position: "1", subframe: 0 }, signal: abort.signal });

		expect(result).toBe(ConversationLiveReplayOutcomes.DurationReached);
		expect(output.join("")).not.toContain("TEXT_MESSAGE_START");
		expect(output.join("")).toContain("TEXT_MESSAGE_CONTENT");
		expect(output.join("")).toContain("TEXT_MESSAGE_END");
		expect(output.join("").match(/TEXT_MESSAGE_CONTENT/gu)).toHaveLength(1);
		expect(readAuthorized).toHaveBeenCalledWith(expect.objectContaining({ cursor: expect.objectContaining({ subframe: 2 }) }));
	});

	it("re-presents one open interrupt overlay without advancing the durable cursor", async function _RestoresInterrupt()
	{
		const output: string[] = [];
		const interrupt = { cursor: undefined, conversationId: "conversation-1", runId: "run-1", position: "1", eventType: "tool.approval_required", occurredAt: "2026-08-11T00:00:00.000Z", payload: { interrupt: { id: "approval-1", reason: "tool_approval", responseSchema: { type: "object" } } } } as const;
		await __StreamConversationLiveReplay({ repository: { readAuthorized: async function _Read() { return { status: ConversationReplayReadStatuses.Authorized, rows: [] }; } }, interrupts: { readOpen: async function _Open() { return [interrupt]; } }, clock: _Clock(), limits: _Limits() }, { open: vi.fn(), write: function _Write(value): boolean { output.push(value); return true; }, drain: vi.fn() }, { conversationId: "conversation-1", siloId: "silo-1", subjectId: "user-1", cursor: null, signal: new AbortController().signal });

		const body = output.join("");
		expect(body.match(/approval-1/gu)).toHaveLength(1);
		expect(body).not.toContain("id:");
	});

	it("publishes the complete open-interrupt set and explicitly clears it", async function _ReplacesInterruptSet()
	{
		const output: string[] = [];
		let reads = 0;
		const first = { cursor: undefined, conversationId: "conversation-1", runId: "run-1", position: "1", eventType: "tool.approval_required", occurredAt: "2026-08-11T00:00:00.000Z", payload: { interrupt: { id: "approval-1", reason: "tool_approval" } } } as const;
		const second = { ...first, payload: { interrupt: { id: "approval-2", reason: "tool_approval" } } } as const;
		await __StreamConversationLiveReplay({ repository: { readAuthorized: async function _Read() { return { status: ConversationReplayReadStatuses.Authorized, rows: [] }; } }, interrupts: { readOpen: async function _Open() { reads += 1; return reads === 1 ? [first, second] : []; } }, clock: _Clock(), limits: _Limits() }, { open: vi.fn(), write: function _Write(value): boolean { output.push(value); return true; }, drain: vi.fn() }, { conversationId: "conversation-1", siloId: "silo-1", subjectId: "user-1", cursor: null, signal: new AbortController().signal });

		const body = output.join("");
		expect(body.match(/approval-1/gu)).toHaveLength(1);
		expect(body.match(/approval-2/gu)).toHaveLength(1);
		expect(body).toContain("opencrane.interrupts_cleared");
	});

	it("signals proven revocation after the stream opened and stops", async function _PurgesOnRevocation()
	{
		let reads = 0;
		const output: string[] = [];
		const readAuthorized = vi.fn(async function _Read()
		{
			reads += 1;
			return reads === 1 ? { status: ConversationReplayReadStatuses.Authorized, rows: [_Row()] } : { status: ConversationReplayReadStatuses.RevokedOrMissing, rows: [] };
		});
		const result = await __StreamConversationLiveReplay({ repository: { readAuthorized }, clock: _Clock(), limits: _Limits(1) }, { open: vi.fn(), write: function _Write(value): boolean { output.push(value); return true; }, drain: vi.fn() }, { conversationId: "conversation-1", siloId: "silo-1", subjectId: "user-1", cursor: null, signal: new AbortController().signal });

		expect(result).toBe(ConversationLiveReplayOutcomes.RevokedOrMissing);
		expect(output.join("")).toContain("opencrane.access_revoked");
		expect(readAuthorized).toHaveBeenCalledTimes(2);
	});

	it("heartbeats below the proxy idle fence while recovery polling", async function _Heartbeats()
	{
		const output: string[] = [];
		await __StreamConversationLiveReplay({ repository: { readAuthorized: async function _Read() { return { status: ConversationReplayReadStatuses.Authorized, rows: [] }; } }, clock: _Clock(), limits: _Limits() }, { open: vi.fn(), write: function _Write(value): boolean { output.push(value); return true; }, drain: vi.fn() }, { conversationId: "conversation-1", siloId: "silo-1", subjectId: "user-1", cursor: null, signal: new AbortController().signal });
		expect(output).toContain(": heartbeat\n\n");
	});

	it("waits for a full response buffer before projecting the next frame", async function _AwaitsBackpressure()
	{
		const output: string[] = [];
		const drain = vi.fn().mockResolvedValue(undefined);
		let writes = 0;
		await __StreamConversationLiveReplay({ repository: { readAuthorized: async function _Read() { return { status: ConversationReplayReadStatuses.Authorized, rows: [_Row()] }; } }, clock: _Clock(), limits: _Limits() }, { open: vi.fn(), write: function _Write(value): boolean { output.push(value); writes += 1; return writes !== 1; }, drain }, { conversationId: "conversation-1", siloId: "silo-1", subjectId: "user-1", cursor: null, signal: new AbortController().signal });

		expect(drain).toHaveBeenCalledTimes(1);
		expect(output.join("")).toContain("TEXT_MESSAGE_END");
	});

	it("fails closed without advancing past an invalid canonical row", async function _RejectsInvalidRow()
	{
		const invalid = { ..._Row(), occurredAt: "not-an-instant" };
		const output: string[] = [];
		await expect(__StreamConversationLiveReplay({ repository: { readAuthorized: async function _Read() { return { status: ConversationReplayReadStatuses.Authorized, rows: [invalid] }; } }, clock: _Clock(), limits: _Limits() }, { open: vi.fn(), write: function _Write(value): boolean { output.push(value); return true; }, drain: vi.fn() }, { conversationId: "conversation-1", siloId: "silo-1", subjectId: "user-1", cursor: null, signal: new AbortController().signal })).rejects.toThrow("canonical conversation replay row is invalid");
		expect(output).toEqual([]);
	});
});
