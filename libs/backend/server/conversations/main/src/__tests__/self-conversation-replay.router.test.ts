import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import type { Logger } from "@opencrane/backend/observability";

import { __CreateSelfConversationReplayRouter } from "../self-conversation-replay.router.js";

/** Mount the self-only replay router with caller and event-reader seams. */
function _app(caller: unknown, read = vi.fn(async function _read() { return []; }))
{
	let now = 0;
	const app = express();
	app.use(__CreateSelfConversationReplayRouter({ resolveCaller: function _caller() { return caller as never; }, repository: { read }, clock: { now: function _Now() { return now; }, wait: async function _Wait(milliseconds) { now += milliseconds; } }, limits: { pageSize: 200, pollMilliseconds: 25, heartbeatMilliseconds: 50, maximumDurationMilliseconds: 50 }, logger: { error: vi.fn() } as unknown as Logger }));
	return { app, read };
}

describe("authenticated conversation replay router", function _suite()
{
	it("derives participant coordinates from the session caller, never the request", async function _derivesOwner()
	{
		const { app, read } = _app({ siloId: "silo-1", subjectId: "user-1" });
		const response = await request(app).get("/conversation-1/events");
		expect(response.status).toBe(200);
		expect(read).toHaveBeenCalledWith({ conversationId: "conversation-1", siloId: "silo-1", subjectId: "user-1", cursor: null, limit: 200 });
	});

	it("refuses unauthenticated and malformed-cursor replay requests", async function _refusesInvalidRequests()
	{
		const unauthenticated = await request(_app(null).app).get("/conversation-1/events");
		expect(unauthenticated.status).toBe(401);
		const { app, read } = _app({ siloId: "silo-1", subjectId: "user-1" });
		const malformed = await request(app).get("/conversation-1/events?cursor=not-a-cursor");
		expect(malformed.status).toBe(400);
		expect(read).not.toHaveBeenCalled();
	});
});
