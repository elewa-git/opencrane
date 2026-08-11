import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { ElicitationBodyKinds } from "@opencrane/contracts";

import { __CreateSelfElicitationRouter } from "../self-elicitation.router.js";
import type { SelfElicitationRouterDependencies } from "../self-elicitation.router.types.js";

/** Build self-only ports with one trusted caller. */
function _Dependencies(overrides: Partial<SelfElicitationRouterDependencies> = {}): SelfElicitationRouterDependencies
{
	return {
		resolveCaller: function _Caller() { return { siloId: "silo-1", subjectId: "user-1", verifiedStepUpAt: null }; },
		elicitations: { open: vi.fn(), readOwned: vi.fn().mockResolvedValue(null), respond: vi.fn().mockResolvedValue({ outcome: "accepted", projection: { requestId: "request-1", state: "answered", idempotent: false, resolvedAt: "2026-08-11T10:00:00.000Z" } }) },
		clock: { now: function _Now() { return new Date("2026-08-11T10:00:00.000Z"); } },
		logger: { error: vi.fn() } as never,
		...overrides,
	};
}

/** Mount the conversation-scoped route exactly as production does. */
function _App(dependencies: SelfElicitationRouterDependencies)
{
	const app = express();
	app.use(express.json());
	app.use("/api/v1/me/conversations", __CreateSelfElicitationRouter(dependencies));
	return app;
}

describe("__CreateSelfElicitationRouter", function _Suite()
{
	it("reads only through session-derived ownership", async function _Reads()
	{
		const elicitation = { requestId: "request-1" } as never;
		const dependencies = _Dependencies({ elicitations: { open: vi.fn(), readOwned: vi.fn().mockResolvedValue(elicitation), respond: vi.fn() } });
		const response = await request(_App(dependencies)).get("/api/v1/me/conversations/conversation-1/elicitations/request-1");
		expect(response.status).toBe(200);
		expect(response.body).toEqual({ elicitation: { requestId: "request-1" } });
		expect(dependencies.elicitations.readOwned).toHaveBeenCalledWith("silo-1", "conversation-1", "request-1", "user-1", new Date("2026-08-11T10:00:00.000Z"));
	});

	it("rejects browser-supplied authority and passes only the typed answer", async function _Responds()
	{
		const dependencies = _Dependencies();
		const invalid = await request(_App(dependencies)).post("/api/v1/me/conversations/conversation-1/elicitations/request-1/responses").send({ idempotencyKey: "retry-1", response: { kind: ElicitationBodyKinds.Approval, approved: true }, subjectId: "forged" });
		expect(invalid.status).toBe(400);
		const accepted = await request(_App(dependencies)).post("/api/v1/me/conversations/conversation-1/elicitations/request-1/responses").send({ idempotencyKey: "retry-1", response: { kind: ElicitationBodyKinds.Approval, approved: true } });
		expect(accepted.status).toBe(200);
		expect(dependencies.elicitations.respond).toHaveBeenCalledWith(expect.objectContaining({ siloId: "silo-1", conversationId: "conversation-1", requestId: "request-1", subjectId: "user-1", verifiedStepUpAt: null }));
	});

	it("maps step-up, conflict, expiry, and foreign ownership safely", async function _MapsOutcomes()
	{
		for (const [outcome, status] of [["step_up_required", 428], ["conflict", 409], ["expired", 409], ["unauthorized", 403]] as const)
		{
			const dependencies = _Dependencies({ elicitations: { open: vi.fn(), readOwned: vi.fn(), respond: vi.fn().mockResolvedValue({ outcome }) } });
			const response = await request(_App(dependencies)).post("/api/v1/me/conversations/conversation-1/elicitations/request-1/responses").send({ idempotencyKey: "retry-1", response: { kind: ElicitationBodyKinds.FreeText, text: "answer" } });
			expect(response.status).toBe(status);
			if (outcome === "step_up_required") expect(response.body).toEqual({ error: "elicitation_step_up_required", reauthenticatePath: "/api/v1/auth/reauthenticate" });
		}
	});

	it("requires a browser session for reads and answers", async function _RequiresSession()
	{
		const dependencies = _Dependencies({ resolveCaller: function _Missing() { return null; } });
		expect((await request(_App(dependencies)).get("/api/v1/me/conversations/conversation-1/elicitations/request-1")).status).toBe(401);
		expect((await request(_App(dependencies)).post("/api/v1/me/conversations/conversation-1/elicitations/request-1/responses").send({})).status).toBe(401);
	});
});
