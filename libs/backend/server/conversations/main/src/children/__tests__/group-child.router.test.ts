import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { _CreateGroupChildRouter } from "../group-child.router";
import { GroupChildConflictError } from "../group-child.errors";

const _KEY = "31c1f1dc-0010-4f13-9c2f-d3841ffd6651";
const _CALLER = { siloId: "silo", principalId: "principal", subjectId: "subject" };

/** Mounts the participant router with a caller resolved outside the browser command. */
function _Fixture()
{
	const authority = { create: vi.fn().mockResolvedValue({ state: "pending" }), list: vi.fn().mockResolvedValue([]), share: vi.fn().mockResolvedValue({ outcome: "accepted", position: "4" }) };
	const logger = { warn: vi.fn() };
	const app = express(); app.use(express.json()); app.use("/me/conversations", _CreateGroupChildRouter(authority, () => _CALLER, logger));
	return { app, authority, logger };
}

describe("group child participant router", () =>
{
	it("binds exact source coordinates and rejects browser-supplied audience", async () =>
	{
		const f = _Fixture(); const command = { parentMessageId: _KEY, parentMessagePosition: "2", agentServiceId: "company", idempotencyKey: _KEY };
		const admitted = await request(f.app).post("/me/conversations/parent/children").send(command);
		expect(admitted.status).toBe(202); expect(admitted.body).toEqual({ child: { state: "pending" } });
		expect(admitted.headers["cache-control"]).toBe("no-store");
		expect(f.authority.create).toHaveBeenCalledWith(_CALLER, "parent", command);
		expect((await request(f.app).post("/me/conversations/parent/children").send({ ...command, participantIds: ["foreign"] })).status).toBe(400);
		expect(f.authority.create).toHaveBeenCalledTimes(1);
	});
	it("returns reviewed share receipts and the same fixed unavailable error", async () =>
	{
		const f = _Fixture(); const command = { sourceEntryId: _KEY, sourcePosition: "3", text: "Reviewed", idempotencyKey: _KEY };
		expect((await request(f.app).post("/me/conversations/child/share").send(command)).status).toBe(202);
		f.authority.share.mockResolvedValueOnce({ outcome: "idempotent", position: "4" });
		expect((await request(f.app).post("/me/conversations/child/share").send(command)).status).toBe(200);
		f.authority.share.mockResolvedValueOnce(null as never);
		const denied = await request(f.app).post("/me/conversations/child/share").send(command);
		expect(denied.status).toBe(404); expect(denied.body).toEqual({ error: "conversation_unavailable" });
	});
	it("reports command conflict and hides dependency details", async () =>
	{
		const f = _Fixture(); f.authority.list.mockRejectedValueOnce(new GroupChildConflictError());
		expect((await request(f.app).get("/me/conversations/parent/children")).status).toBe(409);
		f.authority.list.mockRejectedValueOnce(new Error("secret database payload"));
		const failure = await request(f.app).get("/me/conversations/parent/children");
		expect(failure.status).toBe(503); expect(failure.body).toEqual({ error: "conversation_authority_unavailable" });
		expect(f.logger.warn.mock.calls[0]?.[0].err.message).toBe("Group child operation failed");
	});
});
