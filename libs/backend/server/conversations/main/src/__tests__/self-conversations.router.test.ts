import express, { type Express } from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { __CreateSelfConversationsRouter } from "../self-conversations.router";

/** Mounts the router with one authenticated caller unless explicitly disabled. */
function _App(authority: object, authenticated = true): Express
{
	const app = express();
	app.use(express.json());
	app.use(__CreateSelfConversationsRouter({ resolveCaller: function _Caller() { return authenticated ? { siloId: "silo-1", issuer: "https://issuer.test", subjectId: "user-1" } : null; }, authority: authority as never, logger: { error: vi.fn(), warn: vi.fn() } as never }));
	return app;
}

describe("self conversations router", function _Suite()
{
	it("requires browser authentication before conversation authority", async function _RequiresAuthentication()
	{
		const list = vi.fn();
		await request(_App({ list }, false)).get("/").expect(401, { error: "conversation_authentication_required" });
		expect(list).not.toHaveBeenCalled();
	});

	it("returns only opaque creation references and the caller's projected Agent", async function _ReturnsDirectory()
	{
		const directory = vi.fn().mockResolvedValue({ participants: [{ participantRef: "member-1", isSelf: true }, { participantRef: "member-2", isSelf: false }], personalAgentStatus: "ready", personalAgent: { personalAgentRef: "service-1", displayName: "My Agent" } });
		const response = await request(_App({ directory })).get("/directory").expect(200);
		expect(response.body).toEqual({ directory: await directory.mock.results[0]?.value });
		expect(JSON.stringify(response.body)).not.toContain("user-1");
	});

	it("rejects caller-supplied authority coordinates", async function _RejectsAuthorityCoordinates()
	{
		const create = vi.fn();
		await request(_App({ create })).post("/").send({ mode: "agent_session", personalAgentRef: "service-1", siloId: "forged" }).expect(400, { error: "invalid_conversation_request" });
		expect(create).not.toHaveBeenCalled();
	});

	it("rejects participant-authored tool presentation blocks", async function _RejectsToolSpoofing()
	{
		const submitMessage = vi.fn();
		await request(_App({ submitMessage })).post("/conversation-1/messages").send({ idempotencyKey: "request-1", blocks: [{ id: "block-1", kind: "tool_call", value: "pretend" }] }).expect(400, { error: "invalid_conversation_message" });
		expect(submitMessage).not.toHaveBeenCalled();
	});

	it("returns accepted and idempotent message outcomes with distinct statuses", async function _ReturnsMessageOutcomes()
	{
		const message = { id: "message-1", position: "2" };
		const submitMessage = vi.fn().mockResolvedValueOnce({ outcome: "accepted", message }).mockResolvedValueOnce({ outcome: "idempotent", message });
		const app = _App({ submitMessage });
		const body = { idempotencyKey: "request-1", blocks: [{ id: "block-1", kind: "text", value: "Hello" }] };

		await request(app).post("/conversation-1/messages").send(body).expect(201, { outcome: "accepted", message });
		await request(app).post("/conversation-1/messages").send(body).expect(200, { outcome: "idempotent", message });
		expect(submitMessage).toHaveBeenCalledWith({ siloId: "silo-1", issuer: "https://issuer.test", subjectId: "user-1" }, "conversation-1", body);
	});

	it("maps closed and active-run conflicts without exposing authority detail", async function _MapsConflicts()
	{
		const submitMessage = vi.fn().mockResolvedValue({ outcome: "denied", reason: "active_run" });
		await request(_App({ submitMessage })).post("/conversation-1/messages").send({ idempotencyKey: "request-1", blocks: [{ id: "block-1", kind: "text", value: "Later" }] }).expect(409, { error: "active_run" });
	});

	it("maps bounded admission capacity to retryable overload instead of persistence outage", async function _MapsCapacity()
	{
		const submitMessage = vi.fn().mockResolvedValue({ outcome: "denied", reason: "capacity_limited" });
		await request(_App({ submitMessage })).post("/conversation-1/messages").send({ idempotencyKey: "request-1", blocks: [{ id: "block-1", kind: "text", value: "Later" }] }).expect(429, { error: "capacity_limited" });
	});

	it("starts and idempotently replays an exact participant run retry", async function _RetriesRun()
	{
		const retryRun = vi.fn()
			.mockResolvedValueOnce({ outcome: "started", run: { id: "run-1", attempt: 2 } })
			.mockResolvedValueOnce({ outcome: "idempotent", run: { id: "run-1", attempt: 2 } });
		const app = _App({ retryRun });
		const body = { expectedAttempt: 1, idempotencyKey: "retry-1" };

		await request(app).post("/conversation-1/runs/run-1/retry").send(body).expect(201, { outcome: "started", runId: "run-1", attempt: 2 });
		await request(app).post("/conversation-1/runs/run-1/retry").send(body).expect(200, { outcome: "idempotent", runId: "run-1", attempt: 2 });
		expect(retryRun).toHaveBeenCalledWith({ siloId: "silo-1", issuer: "https://issuer.test", subjectId: "user-1" }, "conversation-1", "run-1", body);
	});

	it("hides unauthorized retries and exposes only the current conflicting attempt", async function _MapsRetryDenials()
	{
		const retryRun = vi.fn()
			.mockResolvedValueOnce({ outcome: "denied", reason: "unauthorized" })
			.mockResolvedValueOnce({ outcome: "denied", reason: "attempt_conflict", currentAttempt: 3 });
		const app = _App({ retryRun });
		const body = { expectedAttempt: 1, idempotencyKey: "retry-1" };

		await request(app).post("/conversation-1/runs/run-1/retry").send(body).expect(404, { error: "unauthorized" });
		await request(app).post("/conversation-1/runs/run-1/retry").send(body).expect(409, { error: "attempt_conflict", currentAttempt: 3 });
	});

	it("rejects malformed retry coordinates before run authority", async function _RejectsMalformedRetry()
	{
		const retryRun = vi.fn();
		await request(_App({ retryRun })).post("/conversation-1/runs/run-1/retry").send({ expectedAttempt: 0, idempotencyKey: "retry-1" }).expect(400, { error: "invalid_run_retry" });
		expect(retryRun).not.toHaveBeenCalled();
	});

	it("converts an unexpected authority failure into a bounded persistence response", async function _BoundsFailure()
	{
		const open = vi.fn().mockRejectedValue(new Error("database connection contained private detail"));
		await request(_App({ open })).get("/conversation-1").expect(503, { error: "persistence_unavailable" });
	});

	it("advances an exact Agent-thread read coordinate and maps bounded denials", async function _MarksAgentThreadRead()
	{
		const markAgentThreadRead = vi.fn().mockResolvedValueOnce({ outcome: "changed", readThroughPosition: "5" }).mockResolvedValueOnce({ outcome: "idempotent", readThroughPosition: "5" }).mockResolvedValueOnce({ outcome: "denied", reason: "observed_position_unavailable" }).mockResolvedValueOnce({ outcome: "denied", reason: "conversation_unavailable" });
		const app = _App({ markAgentThreadRead });

		await request(app).put("/parent-1/agent-threads/child-1/read-through").send({ observedPosition: "5" }).expect(200, { outcome: "changed", readThroughPosition: "5" });
		await request(app).put("/parent-1/agent-threads/child-1/read-through").send({ observedPosition: "3" }).expect(200, { outcome: "idempotent", readThroughPosition: "5" });
		await request(app).put("/parent-1/agent-threads/child-1/read-through").send({ observedPosition: "6" }).expect(409, { error: "observed_position_unavailable" });
		await request(app).put("/parent-1/agent-threads/child-1/read-through").send({ observedPosition: "2" }).expect(404, { error: "conversation_unavailable" });
		expect(markAgentThreadRead).toHaveBeenCalledWith({ siloId: "silo-1", issuer: "https://issuer.test", subjectId: "user-1" }, "parent-1", "child-1", "5");
	});

	it("rejects malformed Agent-thread read positions before authority", async function _RejectsMalformedRead()
	{
		const markAgentThreadRead = vi.fn();
		await request(_App({ markAgentThreadRead })).put("/parent-1/agent-threads/child-1/read-through").send({ observedPosition: "9223372036854775808" }).expect(400, { error: "invalid_agent_thread_read_position" });
		expect(markAgentThreadRead).not.toHaveBeenCalled();
	});
});
