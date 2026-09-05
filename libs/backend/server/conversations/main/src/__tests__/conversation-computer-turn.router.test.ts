import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { _CreateConversationComputerTurnRouter } from "../conversation-computer-turn.router";

/** Mount the private router with controlled identity and product authority. */
function _App()
{
	const workload = { subject: "system:serviceaccount:testv5:computer", namespace: "testv5", serviceAccountName: "computer", podUid: "pod-1" };
	const authority = { bootstrap: vi.fn().mockResolvedValue({ outcome: "ready", bootstrapId: "bootstrap-1", compiledInput: { digest: "sha256:input", messages: [] }, modelCredential: { endpoint: "http://litellm:4000", key: "sk-attempt", model: "silo-default" } }), appendOutput: vi.fn().mockResolvedValue("accepted") };
	const app = express();
	app.use(express.json({ limit: 70_000 }));
	app.use(_CreateConversationComputerTurnRouter({ tokenReviewer: { __Review: vi.fn().mockResolvedValue(workload) }, authority } as never));
	return { app, authority, workload };
}

describe("conversation computer private turn router", function _Suite()
{
	it("passes only TokenReviewed identity and exact lease coordinates to bootstrap authority", async function _Bootstrap()
	{
		const fixture = _App();
		const response = await request(fixture.app).get("/bootstrap?computerId=computer-one&generation=2&leaseId=lease-one").set("authorization", "Bearer projected-token");
		expect(response.status).toBe(200);
		expect(fixture.authority.bootstrap).toHaveBeenCalledWith({ computerId: "computer-one", generation: 2, leaseId: "lease-one", workload: fixture.workload });
	});

	it("passes only bounded safe text to the output authority", async function _Output()
	{
		const fixture = _App();
		const response = await request(fixture.app).post("/output").set("authorization", "Bearer projected-token").send({ bootstrapId: "bootstrap-1", sourceCommandId: "31c1f1dc-0010-4f13-9c2f-d3841ffd6651", text: "answer" });
		expect(response.status).toBe(202);
		expect(fixture.authority.appendOutput).toHaveBeenCalledWith(expect.objectContaining({ bootstrapId: "bootstrap-1", text: "answer", workload: fixture.workload }));
	});

	it("rejects oversized output before product authority", async function _OversizedOutput()
	{
		const fixture = _App();
		const response = await request(fixture.app).post("/output").set("authorization", "Bearer projected-token").send({ bootstrapId: "bootstrap-1", sourceCommandId: "31c1f1dc-0010-4f13-9c2f-d3841ffd6651", text: "x".repeat(65_537) });
		expect(response.status).toBe(400);
		expect(fixture.authority.appendOutput).not.toHaveBeenCalled();
	});

	it("returns an explicit rebootstrap response for a stale revision or lease", async function _Stale()
	{
		const fixture = _App();
		fixture.authority.appendOutput.mockRejectedValue(new Error("stale revision"));
		const response = await request(fixture.app).post("/output").set("authorization", "Bearer projected-token").send({ bootstrapId: "bootstrap-1", sourceCommandId: "31c1f1dc-0010-4f13-9c2f-d3841ffd6651", text: "answer" });
		expect(response.status).toBe(409);
		expect(response.body).toEqual({ error: "conversation_computer_rebootstrap_required" });
	});
});
