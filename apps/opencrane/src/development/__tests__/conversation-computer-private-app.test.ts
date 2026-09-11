import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { ConversationComputerRealizationKinds } from "@opencrane/contracts";

import { _CreateHostDevelopmentConversationComputerPrivateApp } from "../conversation-computer-private-app";

/** Build the private app with replaceable authentication and product authority. */
function _Harness()
{
	const process = { kind: ConversationComputerRealizationKinds.HostDevelopmentProcess, processId: "local-computer-1" } as const;
	const authenticator = { authenticate: vi.fn().mockResolvedValue(process) };
	const authority = { reviewCredential: vi.fn(), bootstrap: vi.fn().mockResolvedValue({ bootstrapId: "11111111-1111-5111-8111-111111111111", outcome: "ready" }), modelStep: vi.fn().mockResolvedValue({ outcome: "completed" }) };
	const logger = { warn: vi.fn() };
	return { app: _CreateHostDevelopmentConversationComputerPrivateApp({ authenticator, authority, logger }), authenticator, authority, process };
}

describe("Tier 2 host conversation-computer private app", function _Suite(): void
{
	it("admits bootstrap through the host bearer identity", async function _Bootstrap(): Promise<void>
	{
		const harness = _Harness();
		const response = await request(harness.app).get("/api/internal/conversation-computer/bootstrap").query({ computerId: "computer-1", generation: 3, leaseId: "lease-3" }).set("Authorization", "Bearer private-bearer");
		expect(response.status).toBe(200);
		expect(harness.authenticator.authenticate).toHaveBeenCalledWith("private-bearer");
		expect(harness.authority.bootstrap).toHaveBeenCalledWith({ computerId: "computer-1", lease: { leaseId: "lease-3", leaseGeneration: 3 }, process: harness.process });
	});

	it("admits only the existing model-step envelope", async function _ModelStep(): Promise<void>
	{
		const harness = _Harness();
		const bootstrapId = "11111111-1111-5111-8111-111111111111";
		const response = await request(harness.app).post("/api/internal/conversation-computer/model-step").set("Authorization", "Bearer private-bearer").send({ bootstrapId });
		expect(response.status).toBe(200);
		expect(harness.authority.modelStep).toHaveBeenCalledWith({ bootstrapId, process: harness.process });
	});

	it("does not expose production review or checkpoint routes", async function _RefusesProductionRoutes(): Promise<void>
	{
		const harness = _Harness();
		const review = await request(harness.app).get("/api/internal/conversation-computer/review-credential").set("Authorization", "Bearer private-bearer");
		const checkpoint = await request(harness.app).post("/api/internal/conversation-computer/checkpoint/restore").set("Authorization", "Bearer private-bearer").send({});
		expect(review.status).toBe(404);
		expect(checkpoint.status).toBe(404);
		expect(harness.authority.reviewCredential).not.toHaveBeenCalled();
	});

	it("refuses an invalid bearer before product authority", async function _RejectsBearer(): Promise<void>
	{
		const harness = _Harness();
		harness.authenticator.authenticate.mockResolvedValue(null);
		const response = await request(harness.app).get("/api/internal/conversation-computer/bootstrap").query({ computerId: "computer-1", generation: 3, leaseId: "lease-3" }).set("Authorization", "Bearer invalid");
		expect(response.status).toBe(401);
		expect(harness.authority.bootstrap).not.toHaveBeenCalled();
	});
});
