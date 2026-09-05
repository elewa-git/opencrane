import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { _CreateSelfConversationHistoryRouter } from "../self-conversation-history.router";
import type { SelfConversationHistoryAuthority } from "../self-conversation-history.types";

/** Authenticated participant fixture resolved outside browser-controlled request data. */
const _CALLER = { siloId: "silo-1", subjectId: "subject-1", principalId: "principal-1" } as const;

/** Mounts one isolated participant history router with a mocked domain authority. */
function _App(authority: SelfConversationHistoryAuthority)
{
	const app = express();
	app.use(express.json());
	app.use("/api/v1/me/conversations", _CreateSelfConversationHistoryRouter({ authority, resolveCaller: function _Resolve() { return _CALLER; } }));
	return app;
}

describe("_CreateSelfConversationHistoryRouter", function _DescribeRouter()
{
	it("treats afterPosition as an exclusive decimal cursor", async function _ReadsExclusiveCursor()
	{
		const read = vi.fn().mockResolvedValue({ entries: [], payloads: {}, nextPosition: "7", computer: null });
		const response = await request(_App({ read, postMessage: vi.fn() })).get("/api/v1/me/conversations/conversation-1/history?afterPosition=7");
		expect(response.status).toBe(200);
		expect(read).toHaveBeenCalledWith(_CALLER, "conversation-1", 7n);
		expect(response.body).toEqual({ entries: [], payloads: {}, nextPosition: "7", computer: null });
	});

	it("returns accepted and idempotent message outcomes with distinct success statuses", async function _PostsMessages()
	{
		const postMessage = vi.fn().mockResolvedValueOnce({ outcome: "accepted", position: "2" }).mockResolvedValueOnce({ outcome: "idempotent", position: "2" });
		const app = _App({ read: vi.fn(), postMessage });
		const body = { idempotencyKey: "31c1f1dc-0010-4f13-9c2f-d3841ffd6651", text: "hello", activation: "none" };
		expect((await request(app).post("/api/v1/me/conversations/conversation-1/messages").send(body)).status).toBe(202);
		expect((await request(app).post("/api/v1/me/conversations/conversation-1/messages").send(body)).status).toBe(200);
		expect(postMessage).toHaveBeenNthCalledWith(1, _CALLER, "conversation-1", body);
	});

	it("rejects malformed cursors, bodies, and unavailable participant access", async function _RejectsInvalidRequests()
	{
		const authority = { read: vi.fn().mockResolvedValue(null), postMessage: vi.fn().mockResolvedValue(null) };
		const app = _App(authority);
		expect((await request(app).get("/api/v1/me/conversations/conversation-1/history?afterPosition=-1")).status).toBe(400);
		expect((await request(app).get("/api/v1/me/conversations/conversation-1/history")).status).toBe(404);
		expect((await request(app).post("/api/v1/me/conversations/conversation-1/messages").send({ idempotencyKey: "bad", text: "hello", activation: "none" })).status).toBe(400);
	});
});
