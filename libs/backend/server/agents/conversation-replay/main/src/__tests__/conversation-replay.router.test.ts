import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { __EncodeConversationReplayCursor } from "../replay-cursor.js";
import { __CreateConversationReplayRouter } from "../conversation-replay.router.js";

/** Builds a one-use replay router with a caller-visible reader seam. */
function _App(consumed: unknown, read = vi.fn(async function _read() { return [{ cursor: "e.one", threadId: "thread-1", runId: "run-1", sequence: 1, type: "message.delta", payload: { messageId: "message-1", delta: "hello", proof: "never-forwarded" }, occurredAt: "2026-07-23T10:00:00.000Z" }]; }))
{
	const app = express();
	app.use(__CreateConversationReplayRouter({
		contexts: { consumeInvocationContextAtomically: async function _consume() { return consumed; } } as never,
		repository: { read },
		expectedRouteId: "route-1",
		nowEpochMs: function _now() { return 1_000; },
	}));
	return { app, read };
}

describe("conversation replay router", function _Suite()
{
	it("returns a display-safe AG-UI SSE snapshot after consuming one events-read context", async function _StreamsSnapshot()
	{
		const consumed = { status: "consumed", context: { action: "events.read", runId: null, threadId: "thread-1", siloId: "silo-1", subjectId: "user-1" } };
		const { app, read } = _App(consumed);
		const response = await request(app).get("/").set("authorization", "Bearer context-token");
		expect(response.status).toBe(200);
		expect(response.headers["content-type"]).toContain("text/event-stream");
		expect(response.text).toBe("id: e.one\nevent: ag-ui\ndata: {\"type\":\"TEXT_MESSAGE_CONTENT\",\"messageId\":\"message-1\",\"delta\":\"hello\"}\n\n");
		expect(read).toHaveBeenCalledWith(expect.objectContaining({ threadId: "thread-1", siloId: "silo-1", subjectId: "user-1", cursor: null }));
	});

	it("rejects malformed cursors before consuming a one-use context", async function _RejectsMalformedCursor()
	{
		const consume = vi.fn(async function _consume() { return { status: "denied", reason: "not_found" }; });
		const app = express();
		app.use(__CreateConversationReplayRouter({ contexts: { consumeInvocationContextAtomically: consume } as never, repository: { read: async function _read() { return []; } }, expectedRouteId: "route-1", nowEpochMs: function _now() { return 1_000; } }));
		const response = await request(app).get("/?cursor=not-a-cursor").set("authorization", "Bearer context-token");
		expect(response.status).toBe(400);
		expect(consume).not.toHaveBeenCalled();
	});

	it("accepts the proxy's Last-Event-ID cursor without a query coordinate", async function _UsesLastEventId()
	{
		const cursor = __EncodeConversationReplayCursor({ acceptedAt: "2026-07-23T10:00:00.000Z", runId: "run-1", sequence: 2 });
		const consumed = { status: "consumed", context: { action: "events.read", runId: null, threadId: "thread-1", siloId: "silo-1", subjectId: "user-1" } };
		const { app, read } = _App(consumed, vi.fn(async function _read() { return []; }));
		const response = await request(app).get("/").set("authorization", "Bearer context-token").set("last-event-id", cursor);
		expect(response.status).toBe(200);
		expect(read).toHaveBeenCalledWith(expect.objectContaining({ cursor: { acceptedAt: "2026-07-23T10:00:00.000Z", runId: "run-1", sequence: 2 } }));
	});

	it("denies a context issued for another operation before querying canonical events", async function _DeniesWrongAction()
	{
		const { app, read } = _App({ status: "consumed", context: { action: "command.forward", runId: "run-1", threadId: "thread-1", siloId: "silo-1", subjectId: "user-1" } });
		const response = await request(app).get("/").set("authorization", "Bearer context-token");
		expect(response.status).toBe(403);
		expect(read).not.toHaveBeenCalled();
	});
});
