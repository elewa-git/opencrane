import { ConversationToolProposalOutcomes } from "@opencrane/contracts";
import { ConversationToolProposalRefusal } from "../conversation-tool-proposal-refusal";
import { ConversationToolProposalRefusals } from "../conversation-tool-proposal.types";
import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { _CreateConversationComputerTurnRouter } from "../conversation-computer-turn.router";

/** Mount the private router with controlled identity and product authority. */
function _App()
{
	const workload = { subject: "system:serviceaccount:testv5:computer", namespace: "testv5", serviceAccountName: "computer", podUid: "pod-1" };
	const authority = { proposeTool: vi.fn(), reviewCredential: vi.fn().mockResolvedValue({ reviewCredential: "keyed-review-secret" }), bootstrap: vi.fn().mockResolvedValue({ outcome: "ready", bootstrapId: "bootstrap-1", compiledInput: { digest: "sha256:input", messages: [] }, modelCredential: { endpoint: "http://litellm:4000", key: "sk-attempt", model: "silo-default" } }), appendOutput: vi.fn().mockResolvedValue("accepted") };
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

	it.each([
		{ route: "review-credential", operation: "conversation.computer.review_credential" },
		{ route: "bootstrap", operation: "conversation.computer.bootstrap" },
		{ route: "output", operation: "conversation.computer.output" },
	])("logs a closed diagnostic for $route without retaining credentials or request data", async function _SafeFailure({ route, operation })
	{
		const fixture = _App();
		const failure = Object.assign(new TypeError("PRIVATE_UPSTREAM_MESSAGE", { cause: new Error("PRIVATE_CAUSE") }), { name: "PRIVATE_ERROR_NAME", code: 403, stack: "PRIVATE_STACK", body: { credential: "PRIVATE_PROVIDER_KEY" } });
		fixture.authority.reviewCredential.mockRejectedValue(failure);
		fixture.authority.bootstrap.mockRejectedValue(failure);
		fixture.authority.appendOutput.mockRejectedValue(failure);
		const pending = route === "output"
			? request(fixture.app).post("/output").send({ bootstrapId: "PRIVATE_BOOTSTRAP", sourceCommandId: "31c1f1dc-0010-4f13-9c2f-d3841ffd6651", text: "PRIVATE_MODEL_OUTPUT" })
			: request(fixture.app).get(`/${route}?computerId=PRIVATE_COMPUTER&generation=2&leaseId=PRIVATE_LEASE`);
		const response = await pending.set("authorization", "Bearer PRIVATE_PROJECTED_TOKEN");

		expect(response.status).toBe(409);
		expect(response.body).toEqual({ error: "conversation_computer_rebootstrap_required" });
		expect(fixture.logger.warn).toHaveBeenCalledOnce();
		expect(fixture.logger.warn).toHaveBeenCalledWith({ operation, err: { type: "TypeError", message: "Conversation history operation failed", code: 403 }, errorType: "TypeError" }, expect.stringMatching(/^Conversation computer (review credential|bootstrap|output) unavailable$/));
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

/** Private proposal transport must not mistake a saved selection for provider execution. */
describe("conversation computer private tool proposal", function _Suite()
{
	const body = { bootstrapId: "b1f5a60b-22d8-4dce-b41f-8da167ea0554", toolRevisionId: "tool-1", arguments: { query: "record" } };
	it.each([ConversationToolProposalOutcomes.Recorded, ConversationToolProposalOutcomes.Existing])("returns the server's stable %s receipt", async function _Receipt(outcome)
	{
		const f = _App();
		f.authority.proposeTool.mockResolvedValue({ proposalId: "server-proposal", outcome });
		const response = await request(f.app).post("/tool-proposal").set("authorization", "Bearer token").send(body);
		expect(response.status).toBe(outcome === ConversationToolProposalOutcomes.Recorded ? 202 : 200);
		expect(response.body).toEqual({ proposalId: "server-proposal", outcome });
		expect(f.authority.proposeTool).toHaveBeenCalledWith({ ...body, workload: f.workload });
	});
	it.each([{ ...body, principalId: "forged" }, { ...body, arguments: { query: "\ud800" } }, { ...body, arguments: { ["\udfff"]: "invalid key" } }])("rejects forged authority or malformed Unicode before admission", async function _Invalid(proposal)
	{
		const f = _App();
		const response = await request(f.app).post("/tool-proposal").set("authorization", "Bearer token").set("content-type", "application/json").send(JSON.stringify(proposal));
		expect(response.status).toBe(400);
		expect(f.authority.proposeTool).not.toHaveBeenCalled();
	});
	it.each([[ConversationToolProposalRefusals.Invalid, 400], [ConversationToolProposalRefusals.Conflict, 409], [ConversationToolProposalRefusals.Denied, 403]] as const)("exposes only the closed %s refusal", async function _Refusal(refusal, status)
	{
		const f = _App();
		f.authority.proposeTool.mockRejectedValue(new ConversationToolProposalRefusal(refusal));
		const response = await request(f.app).post("/tool-proposal").set("authorization", "Bearer token").send(body);
		expect(response.status).toBe(status);
		expect(response.body).toEqual({ error: refusal });
	});
	it("requires TokenReview and makes dependency failures retryable without private details", async function _Unavailable()
	{
		const f = _App();
		expect((await request(f.app).post("/tool-proposal").send(body)).status).toBe(401);
		expect(f.authority.proposeTool).not.toHaveBeenCalled();
		f.authority.proposeTool.mockRejectedValue(new Error("PRIVATE_PROVIDER_DETAIL"));
		const response = await request(f.app).post("/tool-proposal").set("authorization", "Bearer PRIVATE_TOKEN").send(body);
		expect(response.status).toBe(503);
		expect(response.headers["retry-after"]).toBe("1");
		expect(JSON.stringify([response.body, f.logger.warn.mock.calls])).not.toContain("PRIVATE_");
	});
});
