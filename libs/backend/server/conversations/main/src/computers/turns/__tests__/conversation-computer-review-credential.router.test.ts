import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { _CreateConversationComputerReviewCredentialRouter } from "../conversation-computer-review-credential.router";

/** Mount the remaining Pod transport with controlled identity and product authority. */
function _App()
{
	const workload = { subject: "system:serviceaccount:testv5:computer", namespace: "testv5", serviceAccountName: "computer", podUid: "pod-1" };
	const authority = { reviewCredential: vi.fn().mockResolvedValue({ reviewCredential: "keyed-review-secret" }), start: vi.fn(), advance: vi.fn() };
	const logger = { warn: vi.fn() };
	const app = express().use(express.json()).use(_CreateConversationComputerReviewCredentialRouter({ logger, tokenReviewer: { __Review: vi.fn().mockResolvedValue(workload) }, authority }));
	return { app, authority, logger, workload };
}

describe("conversation computer review credential router", function _Suite()
{
	it("hands the review credential only to a TokenReviewed Pod with exact lease coordinates", async function _ReviewCredential()
	{
		const fixture = _App();
		const response = await request(fixture.app).get("/review-credential?computerId=computer-one&generation=2&leaseId=lease-one").set("authorization", "Bearer projected-token");
		expect(response.status).toBe(200);
		expect(response.body).toEqual({ reviewCredential: "keyed-review-secret" });
		expect(fixture.authority.reviewCredential).toHaveBeenCalledWith({ computerId: "computer-one", lease: { leaseId: "lease-one", leaseGeneration: 2 }, workload: fixture.workload });
		expect((await request(fixture.app).get("/review-credential?computerId=computer-one&leaseId=lease-one").set("authorization", "Bearer projected-token")).status).toBe(400);
		expect((await request(fixture.app).get("/review-credential?computerId=computer-one&generation=2&leaseId=lease-one")).status).toBe(401);
	});

	it("does not expose Pod routes for bootstrap or model progression", async function _RemovedRoutes()
	{
		const fixture = _App();
		await request(fixture.app).get("/bootstrap?computerId=computer-one&generation=2&leaseId=lease-one").set("authorization", "Bearer projected-token").expect(404);
		await request(fixture.app).post("/model-step").set("authorization", "Bearer projected-token").send({ bootstrapId: "31c1f1dc-0010-4f13-9c2f-d3841ffd6651" }).expect(404);
		expect(fixture.authority.reviewCredential).not.toHaveBeenCalled();
	});

	it("logs a closed diagnostic without retaining credentials or request data", async function _SafeFailure()
	{
		const fixture = _App();
		const failure = Object.assign(new TypeError("PRIVATE_UPSTREAM_MESSAGE", { cause: new Error("PRIVATE_CAUSE") }), { name: "PRIVATE_ERROR_NAME", code: 403, stack: "PRIVATE_STACK", body: { credential: "PRIVATE_PROVIDER_KEY" } });
		fixture.authority.reviewCredential.mockRejectedValue(failure);
		const response = await request(fixture.app).get("/review-credential?computerId=PRIVATE_COMPUTER&generation=2&leaseId=PRIVATE_LEASE").set("authorization", "Bearer PRIVATE_PROJECTED_TOKEN");

		expect(response.status).toBe(409);
		expect(response.body).toEqual({ error: "conversation_computer_rebootstrap_required" });
		expect(fixture.logger.warn).toHaveBeenCalledWith({ operation: "conversation.computer.review_credential", err: { type: "TypeError", message: "Conversation history operation failed", code: 403 }, errorType: "TypeError" }, "Conversation computer review credential unavailable");
		expect(JSON.stringify(fixture.logger.warn.mock.calls)).not.toContain("PRIVATE_");
	});
});
