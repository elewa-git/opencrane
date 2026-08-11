import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { __EncodeConversationReplayCursor } from "../replay-cursor.js";
import { __CreateConversationReplayRouter } from "../conversation-replay.router.js";
import { ConversationReplayReadStatuses } from "../replay-reader.types.js";

/** Deterministic bounded tail dependencies for router tests. */
function _Live()
{
	let now = 0;
	return { clock: { now: function _Now() { return now; }, wait: async function _Wait(milliseconds: number) { now += milliseconds; } }, limits: { pageSize: 200, pollMilliseconds: 25, heartbeatMilliseconds: 50, maximumDurationMilliseconds: 50 } };
}

/** Builds a one-use replay router with a caller-visible reader seam. */
function _App(consumed: unknown, readAuthorized = vi.fn(async function _read() { return { status: ConversationReplayReadStatuses.Authorized, rows: [{ cursor: "c.one", conversationId: "conversation-1", runId: "run-1", position: "1", type: "message.delta", payload: { messageId: "message-1", delta: "hello", proof: "never-forwarded" }, occurredAt: "2026-07-23T10:00:00.000Z" }] }; }))
{
	const app = express();
	app.use(__CreateConversationReplayRouter({
		..._Live(),
		contexts: { consumeInvocationContextAtomically: async function _consume() { return consumed; } } as never,
		repository: { readAuthorized },
		expectedReceiverId: "receiver-1",
		nowEpochMs: function _now() { return 1_000; },
	}));
	return { app, readAuthorized };
}

describe("internal conversation replay router", function _Suite()
{
	it("returns a display-safe AG-UI SSE snapshot after consuming one events-read context", async function _StreamsSnapshot()
	{
		const consumed = { status: "consumed", context: { action: "events.read", conversationId: "conversation-1", siloId: "silo-1", subjectId: "user-1" } };
		const { app, readAuthorized } = _App(consumed);
		const response = await request(app).get("/").set("authorization", "Bearer context-token");
		expect(response.status).toBe(200);
		expect(response.headers["content-type"]).toContain("text/event-stream");
		expect(response.text).toContain("event: ag-ui\ndata: {\"type\":\"TEXT_MESSAGE_CONTENT\",\"messageId\":\"message-1\",\"delta\":\"hello\"}\n\n");
		expect(readAuthorized).toHaveBeenCalledWith(expect.objectContaining({ conversationId: "conversation-1", siloId: "silo-1", subjectId: "user-1", cursor: null }));
	});

	it("rejects malformed cursors before consuming a one-use context", async function _RejectsMalformedCursor()
	{
		const consume = vi.fn(async function _consume() { return { status: "denied", reason: "not_found" }; });
		const app = express();
		app.use(__CreateConversationReplayRouter({ ..._Live(), contexts: { consumeInvocationContextAtomically: consume } as never, repository: { readAuthorized: async function _read() { return { status: ConversationReplayReadStatuses.Authorized, rows: [] }; } }, expectedReceiverId: "receiver-1", nowEpochMs: function _now() { return 1_000; } }));
		const response = await request(app).get("/?cursor=not-a-cursor").set("authorization", "Bearer context-token");
		expect(response.status).toBe(400);
		expect(consume).not.toHaveBeenCalled();
	});

	it("accepts the proxy's Last-Event-ID cursor without a query coordinate", async function _UsesLastEventId()
	{
		const cursor = __EncodeConversationReplayCursor({ conversationId: "conversation-1", position: "2" });
		const consumed = { status: "consumed", context: { action: "events.read", conversationId: "conversation-1", siloId: "silo-1", subjectId: "user-1" } };
		const { app, readAuthorized } = _App(consumed, vi.fn(async function _read() { return { status: ConversationReplayReadStatuses.Authorized, rows: [] }; }));
		const response = await request(app).get("/").set("authorization", "Bearer context-token").set("last-event-id", cursor);
		expect(response.status).toBe(200);
		expect(readAuthorized).toHaveBeenCalledWith(expect.objectContaining({ cursor: { conversationId: "conversation-1", position: "2" } }));
	});

	it("denies a context issued for another operation before querying canonical events", async function _DeniesWrongAction()
	{
		const { app, readAuthorized } = _App({ status: "denied", reason: "not_found" });
		const response = await request(app).get("/").set("authorization", "Bearer context-token");
		expect(response.status).toBe(403);
		expect(readAuthorized).not.toHaveBeenCalled();
	});
});
