import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { CONVERSATION_ELICITATION_VERSION, ElicitationBodyKinds, ElicitationPurposes, ElicitationRequestStates } from "@opencrane/contracts";

import { __CreateSelfElicitationActivityRouter, __CreateSelfElicitationRouter } from "../self-elicitation.router";
import type { SelfElicitationRouterDependencies } from "../self-elicitation.router.types";

/** Build self-only ports with one trusted caller. */
function _Dependencies(overrides: Partial<SelfElicitationRouterDependencies> = {}): SelfElicitationRouterDependencies
{
	return {
		resolveCaller: function _Caller() { return { siloId: "silo-1", subjectId: "user-1", verifiedStepUpAt: null }; },
		elicitations: _Elicitations(),
		clock: { now: function _Now() { return new Date("2026-08-11T10:00:00.000Z"); } },
		logger: { error: vi.fn() } as never,
		...overrides,
	};
}

/** Build one complete generic authority double. */
function _Elicitations(overrides: Record<string, unknown> = {}): SelfElicitationRouterDependencies["elicitations"]
{
	return { open: vi.fn(), readOwned: vi.fn().mockResolvedValue(null), listOpenOwned: vi.fn().mockResolvedValue([]), listActivityOwned: vi.fn().mockResolvedValue([]), respond: vi.fn().mockResolvedValue({ outcome: "accepted", projection: { requestId: "request-1", state: "answered", idempotent: false, resolvedAt: "2026-08-11T10:00:00.000Z" } }), ...overrides } as SelfElicitationRouterDependencies["elicitations"];
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
	it("lists only through session-derived conversation ownership", async function _ListsOpen()
	{
		const listOpenOwned = vi.fn().mockResolvedValue([{ requestId: "request-1" }]);
		const dependencies = _Dependencies({ elicitations: _Elicitations({ listOpenOwned }) });
		const response = await request(_App(dependencies)).get("/api/v1/me/conversations/conversation-1/elicitations?subjectId=forged&limit=1000");
		expect(response.status).toBe(200);
		expect(response.body).toEqual({ elicitations: [{ requestId: "request-1" }] });
		expect(listOpenOwned).toHaveBeenCalledWith("silo-1", "conversation-1", "user-1", new Date("2026-08-11T10:00:00.000Z"));
	});

	it("rejects an invalid selected conversation before listing", async function _RejectsInvalidConversation()
	{
		const dependencies = _Dependencies();
		const response = await request(_App(dependencies)).get("/api/v1/me/conversations/%20/elicitations");
		expect(response.status).toBe(400);
		expect(dependencies.elicitations.listOpenOwned).not.toHaveBeenCalled();
	});

	it("maps an unavailable pending read without exposing internal error detail", async function _MapsPendingReadFailure()
	{
		const dependencies = _Dependencies({ elicitations: _Elicitations({ listOpenOwned: vi.fn().mockRejectedValue(new Error("database detail")) }) });
		const response = await request(_App(dependencies)).get("/api/v1/me/conversations/conversation-1/elicitations");
		expect(response.status).toBe(503);
		expect(response.body).toEqual({ error: "elicitation_read_unavailable" });
		expect(dependencies.logger.error).toHaveBeenCalledWith(expect.objectContaining({ operation: "elicitation.list_open", siloId: "silo-1" }), "Open elicitation read failed");
	});

	it("reads only through session-derived ownership", async function _Reads()
	{
		const elicitation = { requestId: "request-1" } as never;
		const dependencies = _Dependencies({ elicitations: _Elicitations({ readOwned: vi.fn().mockResolvedValue(elicitation) }) });
		const response = await request(_App(dependencies)).get("/api/v1/me/conversations/conversation-1/elicitations/request-1");
		expect(response.status).toBe(200);
		expect(response.body).toEqual({ elicitation: { requestId: "request-1" } });
		expect(dependencies.elicitations.readOwned).toHaveBeenCalledWith("silo-1", "conversation-1", "request-1", "user-1", new Date("2026-08-11T10:00:00.000Z"));
	});

	it("returns the frozen display-safe approval body without protected purpose fields", async function _ReadsApprovalDisclosure()
	{
		const elicitation = {
			version: CONVERSATION_ELICITATION_VERSION,
			requestId: "request-1",
			conversationId: "conversation-1",
			runId: "run-1",
			attempt: 1,
			assignedParticipantId: "user-1",
			purpose: ElicitationPurposes.ToolApproval,
			state: ElicitationRequestStates.Requested,
			body: { kind: ElicitationBodyKinds.Approval, prompt: "Allow this tool?", action: "Invoke tool", target: "records.update", dataUse: "The displayed arguments will be sent.", externalSystem: "Records", consequence: "This invokes the tool once.", proposedArguments: { recordId: "record-1" } },
			requiresStepUp: true,
			requestedAt: "2026-08-11T10:00:00.000Z",
			expiresAt: "2026-08-11T10:05:00.000Z",
		};
		const dependencies = _Dependencies({ elicitations: _Elicitations({ readOwned: vi.fn().mockResolvedValue(elicitation) }) });

		const response = await request(_App(dependencies)).get("/api/v1/me/conversations/conversation-1/elicitations/request-1");

		expect(response.status).toBe(200);
		expect(response.body).toEqual({ elicitation });
		expect(JSON.stringify(response.body)).not.toMatch(/purposePayload|reviewedToolArguments|responseSchema|toolRevisionId|profileId|secret/i);
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
			const dependencies = _Dependencies({ elicitations: _Elicitations({ respond: vi.fn().mockResolvedValue({ outcome }) }) });
			const response = await request(_App(dependencies)).post("/api/v1/me/conversations/conversation-1/elicitations/request-1/responses").send({ idempotencyKey: "retry-1", response: { kind: ElicitationBodyKinds.FreeText, text: "answer" } });
			expect(response.status).toBe(status);
			if (outcome === "step_up_required") expect(response.body).toEqual({ error: "elicitation_step_up_required", reauthenticatePath: "/api/v1/auth/reauthenticate" });
		}
	});

	it("lists a bounded derived Activity index through session ownership", async function _Activity()
	{
		const dependencies = _Dependencies({ elicitations: _Elicitations({ listActivityOwned: vi.fn().mockResolvedValue([{ requestId: "request-1" }]) }) });
		const app = express();
		app.use("/api/v1/me/activity", __CreateSelfElicitationActivityRouter(dependencies));
		const response = await request(app).get("/api/v1/me/activity/elicitations?limit=25");
		expect(response.status).toBe(200);
		expect(response.body).toEqual({ elicitations: [{ requestId: "request-1" }] });
		expect(dependencies.elicitations.listActivityOwned).toHaveBeenCalledWith("silo-1", "user-1", 25, new Date("2026-08-11T10:00:00.000Z"));
	});

	it("requires a browser session for reads and answers", async function _RequiresSession()
	{
		const dependencies = _Dependencies({ resolveCaller: function _Missing() { return null; } });
		expect((await request(_App(dependencies)).get("/api/v1/me/conversations/conversation-1/elicitations")).status).toBe(401);
		expect((await request(_App(dependencies)).get("/api/v1/me/conversations/conversation-1/elicitations/request-1")).status).toBe(401);
		expect((await request(_App(dependencies)).post("/api/v1/me/conversations/conversation-1/elicitations/request-1/responses").send({})).status).toBe(401);
	});
});
