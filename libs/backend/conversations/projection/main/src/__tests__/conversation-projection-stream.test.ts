import { describe, expect, it, vi } from "vitest";
import { AG_UI_A2UI_ENVELOPE_VERSION, AG_UI_RUN_WAIT_STATE_EVENT, AgUiA2uiSurfaceStates, AgUiRunWaitReasons, AgUiToolRecoveryProviderOutcomes, RunEventTypes } from "@opencrane/contracts";

import { __StreamConversationProjection } from "../conversation-projection-stream";
import { ConversationProjectionOutcomes } from "../conversation-projection-stream.types";
import { ConversationProjectionReadStatuses } from "../conversation-projection-reader.types";
import type { ConversationProjectionEventRow } from "../conversation-event-projector.types";

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

function _Row(): ConversationProjectionEventRow
{
	return { cursor: "legacy-row-cursor", conversationId: "conversation-1", runId: null, position: "1", type: "conversation.message", payload: { messageId: "message-1", role: "user", state: "completed", blocks: [{ id: "block-1", kind: "text", value: "hello" }] }, occurredAt: "2026-08-11T00:00:00.000Z" };
}

/** Runs one canonical row through redaction, AG-UI mapping, cursoring and SSE encoding. */
async function _ProjectRow(row: ConversationProjectionEventRow): Promise<string>
{
	const output: string[] = [];
	const abort = new AbortController();
	let reads = 0;
	await __StreamConversationProjection({ reader: { readAuthorized: async function _Read()
	{
		reads += 1;
		if (reads === 1)
			return { status: ConversationProjectionReadStatuses.Authorized, rows: [row] };
		abort.abort();
		return { status: ConversationProjectionReadStatuses.Authorized, rows: [] };
	} }, clock: _Clock(), limits: _Limits() }, { open: vi.fn(), write: function _Write(value): boolean { output.push(value); return true; }, drain: vi.fn() }, { conversationId: "conversation-1", siloId: "silo-1", subjectId: "user-1", cursor: null, signal: abort.signal });
	return output.join("");
}

describe("live conversation projection", function _Suite()
{
	it("resumes inside a multi-frame ordinary message without a gap or duplicate", async function _ResumesSubframe()
	{
		const output: string[] = [];
		const readAuthorized = vi.fn(async function _Read()
		{
			return { status: ConversationProjectionReadStatuses.Authorized, rows: [_Row()] };
		});
		const abort = new AbortController();
		const result = await __StreamConversationProjection({ reader: { readAuthorized }, clock: _Clock(), limits: _Limits() }, { open: vi.fn(), write: function _Write(value): boolean { output.push(value); return true; }, drain: vi.fn() }, { conversationId: "conversation-1", siloId: "silo-1", subjectId: "user-1", cursor: { conversationId: "conversation-1", position: "1", subframe: 0 }, signal: abort.signal });

		expect(result).toBe(ConversationProjectionOutcomes.DurationReached);
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
		await __StreamConversationProjection({ reader: { readAuthorized: async function _Read() { return { status: ConversationProjectionReadStatuses.Authorized, rows: [] }; } }, interrupts: { readOpen: async function _Open() { return [interrupt]; } }, clock: _Clock(), limits: _Limits() }, { open: vi.fn(), write: function _Write(value): boolean { output.push(value); return true; }, drain: vi.fn() }, { conversationId: "conversation-1", siloId: "silo-1", subjectId: "user-1", cursor: null, signal: new AbortController().signal });

		const body = output.join("");
		expect(body.match(/approval-1/gu)).toHaveLength(1);
		expect(body).toMatch(/interrupt:[a-f0-9]{64}/u);
		expect(body).toContain(AG_UI_RUN_WAIT_STATE_EVENT);
		expect(body).toContain(AgUiRunWaitReasons.Approval);
		expect(body).not.toContain("id:");
	});

	it("publishes the complete open-interrupt set and explicitly clears it", async function _ReplacesInterruptSet()
	{
		const output: string[] = [];
		let reads = 0;
		const first = { cursor: undefined, conversationId: "conversation-1", runId: "run-1", position: "1", eventType: "tool.approval_required", occurredAt: "2026-08-11T00:00:00.000Z", payload: { interrupt: { id: "approval-1", reason: "tool_approval" } } } as const;
		const second = { ...first, payload: { interrupt: { id: "approval-2", reason: "tool_approval" } } } as const;
		await __StreamConversationProjection({ reader: { readAuthorized: async function _Read() { return { status: ConversationProjectionReadStatuses.Authorized, rows: [] }; } }, interrupts: { readOpen: async function _Open() { reads += 1; return reads === 1 ? [first, second] : []; } }, clock: _Clock(), limits: _Limits() }, { open: vi.fn(), write: function _Write(value): boolean { output.push(value); return true; }, drain: vi.fn() }, { conversationId: "conversation-1", siloId: "silo-1", subjectId: "user-1", cursor: null, signal: new AbortController().signal });

		const body = output.join("");
		expect(body.match(/approval-1/gu)).toHaveLength(1);
		expect(body.match(/approval-2/gu)).toHaveLength(1);
		expect(body.match(/interrupt:[a-f0-9]{64}/gu)).toHaveLength(2);
		expect(body).toContain("opencrane.interrupts_cleared");
	});

	it("signals proven revocation after the stream opened and stops", async function _PurgesOnRevocation()
	{
		let reads = 0;
		const output: string[] = [];
		const readAuthorized = vi.fn(async function _Read()
		{
			reads += 1;
			return reads === 1 ? { status: ConversationProjectionReadStatuses.Authorized, rows: [_Row()] } : { status: ConversationProjectionReadStatuses.RevokedOrMissing, rows: [] };
		});
		const result = await __StreamConversationProjection({ reader: { readAuthorized }, clock: _Clock(), limits: _Limits(1) }, { open: vi.fn(), write: function _Write(value): boolean { output.push(value); return true; }, drain: vi.fn() }, { conversationId: "conversation-1", siloId: "silo-1", subjectId: "user-1", cursor: null, signal: new AbortController().signal });

		expect(result).toBe(ConversationProjectionOutcomes.RevokedOrMissing);
		expect(output.join("")).toContain("opencrane.access_revoked");
		expect(readAuthorized).toHaveBeenCalledTimes(2);
	});

	it("heartbeats below the proxy idle fence while recovery polling", async function _Heartbeats()
	{
		const output: string[] = [];
		await __StreamConversationProjection({ reader: { readAuthorized: async function _Read() { return { status: ConversationProjectionReadStatuses.Authorized, rows: [] }; } }, clock: _Clock(), limits: _Limits() }, { open: vi.fn(), write: function _Write(value): boolean { output.push(value); return true; }, drain: vi.fn() }, { conversationId: "conversation-1", siloId: "silo-1", subjectId: "user-1", cursor: null, signal: new AbortController().signal });
		expect(output).toContain(": heartbeat\n\n");
	});

	it("waits for a full response buffer before projecting the next frame", async function _AwaitsBackpressure()
	{
		const output: string[] = [];
		const drain = vi.fn().mockResolvedValue(undefined);
		let writes = 0;
		await __StreamConversationProjection({ reader: { readAuthorized: async function _Read() { return { status: ConversationProjectionReadStatuses.Authorized, rows: [_Row()] }; } }, clock: _Clock(), limits: _Limits() }, { open: vi.fn(), write: function _Write(value): boolean { output.push(value); writes += 1; return writes !== 1; }, drain }, { conversationId: "conversation-1", siloId: "silo-1", subjectId: "user-1", cursor: null, signal: new AbortController().signal });

		expect(drain).toHaveBeenCalledTimes(1);
		expect(output.join("")).toContain("TEXT_MESSAGE_END");
	});

	it("fails closed without advancing past an invalid canonical row", async function _RejectsInvalidRow()
	{
		const invalid = { ..._Row(), occurredAt: "not-an-instant" };
		const output: string[] = [];
		await expect(__StreamConversationProjection({ reader: { readAuthorized: async function _Read() { return { status: ConversationProjectionReadStatuses.Authorized, rows: [invalid] }; } }, clock: _Clock(), limits: _Limits() }, { open: vi.fn(), write: function _Write(value): boolean { output.push(value); return true; }, drain: vi.fn() }, { conversationId: "conversation-1", siloId: "silo-1", subjectId: "user-1", cursor: null, signal: new AbortController().signal })).rejects.toThrow("canonical conversation projection row is invalid");
		expect(output).toEqual([]);
	});

	it("fails closed when a reader returns an unknown authority result", async function _RejectsUnknownAuthority()
	{
		const open = vi.fn();
		const readAuthorized = async function _Read() { return { status: "future_status", rows: [] } as never; };
		await expect(__StreamConversationProjection({ reader: { readAuthorized }, clock: _Clock(), limits: _Limits() }, { open, write: vi.fn(() => true), drain: vi.fn() }, { conversationId: "conversation-1", siloId: "silo-1", subjectId: "user-1", cursor: null, signal: new AbortController().signal })).rejects.toThrow("unknown authority result");
		expect(open).not.toHaveBeenCalled();
	});

	it("projects agent-session run and tool events through the complete public stream", async function _ProjectsAgentSessionEvents()
	{
		const cases = [
			{ type: RunEventTypes.RunStarted, payload: {}, expected: '"type":"RUN_STARTED"' },
			{ type: RunEventTypes.ToolFailed, payload: { toolInvocationId: "tool-1", toolRevisionId: "revision-1", errorType: "AuthenticationError", retryCount: 1, retryLimit: 3, retrying: true, authorization: "Bearer never", providerBody: "secret" }, expected: '"failureCode":"AuthenticationError"' },
			{ type: RunEventTypes.ToolRecoveryRequired, payload: { toolInvocationId: "tool-1", expectedAttempt: 2, preparationRetryCount: 1, preparationRetryLimit: 3, providerOutcome: AgUiToolRecoveryProviderOutcomes.UnknownAfterDispatch, arguments: { password: "never" } }, expected: '"recoveryCategory":"manual_action_required"' },
		] as const;
		for (const [index, fixture] of cases.entries())
		{
			const body = await _ProjectRow({ ..._Row(), cursor: `row-${index}`, runId: "run-1", position: `${index + 1}`, type: fixture.type, payload: fixture.payload });
			expect(body).toContain(fixture.expected);
			expect(body).toContain("id: c.");
			expect(body).not.toContain("Bearer never");
			expect(body).not.toContain("password");
			expect(body).not.toContain("providerBody");
		}
	});

	it("projects governed A2UI only after coordinate validation and redaction", async function _ProjectsGovernedA2ui()
	{
		const a2ui = { version: AG_UI_A2UI_ENVELOPE_VERSION, conversationId: "conversation-1", runId: "run-1", messageId: "message-1", surfaceId: "surface-1", sequence: 0, state: AgUiA2uiSurfaceStates.Streaming, operations: [{ beginRendering: { surfaceId: "surface-1", root: "root-1" } }] };
		const body = await _ProjectRow({ ..._Row(), runId: "run-1", type: RunEventTypes.A2uiRenderingBegun, payload: { a2ui, unknownSecret: "secret" } });
		expect(body).toContain(`"name":"${AG_UI_A2UI_ENVELOPE_VERSION}"`);
		expect(body).toContain('"surfaceId":"surface-1"');
		expect(body).not.toContain("unknownSecret");
		expect(body).not.toContain("secret");
	});
});
