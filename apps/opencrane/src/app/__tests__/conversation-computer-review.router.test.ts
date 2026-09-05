import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { _CreateConversationComputerReviewRouter } from "../conversation-computer-review.router";

/** Proves public review traffic cannot choose an upstream host, lease or preview port. */
describe("conversation computer review router", function _Suite()
{
	const resolveReview = vi.fn();
	const fetchReview = vi.fn();
	const principal = { externalSubject: "subject-1", principalId: "principal-1", siloId: "silo-1" };
	const active = { leaseId: "lease-secret", sandboxId: "sandbox-one" };

	beforeEach(function _Reset()
	{
		vi.clearAllMocks();
		resolveReview.mockResolvedValue(active);
		fetchReview.mockResolvedValue(new Response("selected", { status: 200, headers: { "content-type": "text/plain" } }));
	});

	function _App(resolve: () => typeof principal | null = function _Principal() { return principal; })
	{
		const app = express();
		app.use(express.json());
		const router = _CreateConversationComputerReviewRouter({ authority: { resolve: resolveReview }, sandboxNamespace: "computer-ns", fetch: fetchReview }, resolve);
		app.use("/api/v1/me/conversations", router);
		return app;
	}

	it("derives the active sandbox host and lease credential after participant admission", async function _DerivesRoute()
	{
		const response = await request(_App()).get("/api/v1/me/conversations/conversation-1/review/files?path=src/main.ts");
		expect(response.status).toBe(200);
		expect(response.text).toBe("selected");
		expect(fetchReview).toHaveBeenCalledWith("http://sandbox-one.computer-ns.svc.cluster.local:8090/v1/files?path=src%2Fmain.ts", expect.objectContaining({ headers: { authorization: "Bearer lease-secret" }, method: "GET", redirect: "manual" }));
	});

	it("rejects a caller-selected preview port before any upstream exchange", async function _RejectsPort()
	{
		const response = await request(_App()).get("/api/v1/me/conversations/conversation-1/review/previews/9000/index.html");
		expect(response.status).toBe(400);
		expect(fetchReview).not.toHaveBeenCalled();
	});

	it("does not load a lease when participant admission fails", async function _RejectsParticipant()
	{
		resolveReview.mockResolvedValue(null);
		const response = await request(_App()).get("/api/v1/me/conversations/conversation-1/review/diff?path=src/main.ts");
		expect(response.status).toBe(404);
		expect(fetchReview).not.toHaveBeenCalled();
	});

	it("rejects a missing authenticated principal", async function _RejectsIdentity()
	{
		const response = await request(_App(function _Missing() { return null; })).post("/api/v1/me/conversations/conversation-1/review/commands").send({ argv: ["git", "status"] });
		expect(response.status).toBe(401);
		expect(resolveReview).not.toHaveBeenCalled();
	});
});
