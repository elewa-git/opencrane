import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { _CreateConversationComputerTurnRouter } from "../conversation-computer-turn.router";

/** Mount the private router with controlled identity and product authority. */
function _App()
{
	const workload = { subject: "system:serviceaccount:testv5:computer", namespace: "testv5", serviceAccountName: "computer", podUid: "pod-1" };
	const authority = { reviewCredential: vi.fn().mockResolvedValue({ reviewCredential: "keyed-review-secret" }), bootstrap: vi.fn().mockResolvedValue({ outcome: "ready", bootstrapId: "bootstrap-1",  }), modelStep: vi.fn().mockResolvedValue({ outcome: "completed" }) };
	const logger = { warn: vi.fn() };
	const app = express();
	app.use(express.json({ limit: 70_000 }));
	app.use(_CreateConversationComputerTurnRouter({ logger, tokenReviewer: { __Review: vi.fn().mockResolvedValue(workload) }, authority }));
	return { app, authority, logger, workload };
}

describe("conversation computer private turn router", function _Suite()
{
	it("passes only TokenReviewed identity and exact lease coordinates to bootstrap authority", async function _Bootstrap()
	{
		const fixture = _App();
		const response = await request(fixture.app).get("/bootstrap?computerId=computer-one&generation=2&leaseId=lease-one").set("authorization", "Bearer projected-token");
		expect(response.status).toBe(200);
		expect(fixture.authority.bootstrap).toHaveBeenCalledWith({ computerId: "computer-one", lease: { leaseId: "lease-one", leaseGeneration: 2 }, workload: fixture.workload });
	});

	it("hands the review credential only to a TokenReviewed Pod with exact lease coordinates", async function _ReviewCredential()
	{
		const fixture = _App();
		const response = await request(fixture.app).get("/review-credential?computerId=computer-one&generation=2&leaseId=lease-one").set("authorization", "Bearer projected-token");
		expect(response.status).toBe(200);
		expect(response.body).toEqual({ reviewCredential: "keyed-review-secret" });
		expect(fixture.authority.reviewCredential).toHaveBeenCalledWith({ computerId: "computer-one", lease: { leaseId: "lease-one", leaseGeneration: 2 }, workload: fixture.workload });
		expect((await request(fixture.app).get("/review-credential?computerId=computer-one&leaseId=lease-one").set("authorization", "Bearer projected-token")).status).toBe(400);
		expect((await request(fixture.app).get("/review-credential?computerId=computer-one&generation=2&leaseId=lease-one")).status).toBe(401);
		fixture.authority.reviewCredential.mockRejectedValue(new Error("not the bound Pod"));
		expect((await request(fixture.app).get("/review-credential?computerId=computer-one&generation=2&leaseId=lease-one").set("authorization", "Bearer projected-token")).status).toBe(409);
	});

	it("accepts only a bootstrap identifier and removes Pod-authored output and proposals", async function _ModelStep()
	{
		const fixture = _App();
		const body = { bootstrapId: "31c1f1dc-0010-4f13-9c2f-d3841ffd6651" };
		const response = await request(fixture.app).post("/model-step").set("authorization", "Bearer projected-token").send(body);
		expect(response.status).toBe(200);
		expect(response.body).toEqual({ outcome: "completed" });
		expect(fixture.authority.modelStep).toHaveBeenCalledWith({ ...body, workload: fixture.workload });
		for (const invalid of [{ ...body, text: "forged" }, { ...body, key: "forged" }, { ...body, ordinal: 2 }, { ...body, ordinal: 1 }, { ...body, bootstrapId: "invalid" }])
			expect((await request(fixture.app).post("/model-step").set("authorization", "Bearer projected-token").send(invalid)).status).toBe(400);
		expect((await request(fixture.app).post("/model-step").send(body)).status).toBe(401);
		expect((await request(fixture.app).post("/output").set("authorization", "Bearer projected-token").send({ text: "forged" })).status).toBe(404);
		expect((await request(fixture.app).post("/tool-proposal").set("authorization", "Bearer projected-token").send({ bootstrapId: body.bootstrapId, arguments: {} })).status).toBe(404);
		expect(fixture.authority.modelStep).toHaveBeenCalledOnce();
	});

	it.each([
		{ route: "review-credential", operation: "conversation.computer.review_credential" },
		{ route: "bootstrap", operation: "conversation.computer.bootstrap" },
		{ route: "model-step", operation: "conversation.computer.model_step" },
	])("logs a closed diagnostic for $route without retaining credentials or request data", async function _SafeFailure({ route, operation })
	{
		const fixture = _App();
		const failure = Object.assign(new TypeError("PRIVATE_UPSTREAM_MESSAGE", { cause: new Error("PRIVATE_CAUSE") }), { name: "PRIVATE_ERROR_NAME", code: 403, stack: "PRIVATE_STACK", body: { credential: "PRIVATE_PROVIDER_KEY" } });
		fixture.authority.reviewCredential.mockRejectedValue(failure);
		fixture.authority.bootstrap.mockRejectedValue(failure);
		fixture.authority.modelStep.mockRejectedValue(failure);
		const pending = route === "model-step"
			? request(fixture.app).post("/model-step").send({ bootstrapId: "31c1f1dc-0010-4f13-9c2f-d3841ffd6651" })
			: request(fixture.app).get(`/${route}?computerId=PRIVATE_COMPUTER&generation=2&leaseId=PRIVATE_LEASE`);
		const response = await pending.set("authorization", "Bearer PRIVATE_PROJECTED_TOKEN");

		expect(response.status).toBe(409);
		expect(response.body).toEqual({ error: "conversation_computer_rebootstrap_required" });
		expect(fixture.logger.warn).toHaveBeenCalledOnce();
		expect(fixture.logger.warn).toHaveBeenCalledWith({ operation, err: { type: "TypeError", message: "Conversation history operation failed", code: 403 }, errorType: "TypeError" }, expect.stringMatching(/^Conversation computer (review credential|bootstrap|model step) unavailable$/));
		expect(JSON.stringify(fixture.logger.warn.mock.calls)).not.toContain("PRIVATE_");
		expect(JSON.stringify(fixture.logger.warn.mock.calls)).not.toContain("31c1f1dc");
	});

	it("does not invoke an untrusted diagnostic code getter", async function _UntrustedDiagnosticCode()
	{
		const fixture = _App();
		const getter = vi.fn(function _PrivateCode() { throw new Error("PRIVATE_GETTER"); });
		const failure = Object.assign(new Error("PRIVATE_MESSAGE"), { name: "PRIVATE_NAME" });
		Object.defineProperty(failure, "code", { get: getter });
		fixture.authority.reviewCredential.mockRejectedValue(failure);
		const response = await request(fixture.app).get("/review-credential?computerId=computer-one&generation=2&leaseId=lease-one").set("authorization", "Bearer projected-token");

		expect(response.status).toBe(409);
		expect(fixture.logger.warn.mock.calls[0]?.[0].err).toEqual({ type: "Error", message: "Conversation history operation failed" });
		expect(getter).not.toHaveBeenCalled();
		expect(JSON.stringify(fixture.logger.warn.mock.calls)).not.toContain("PRIVATE_");
	});
});
