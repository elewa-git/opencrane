import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProductAuthorizationActions } from "@opencrane/models/authorization";

import { _CreateConversationComputerReviewRouter } from "../conversation-computer-review.router";

/** Proves public review traffic cannot choose an upstream host, lease or preview port. */
describe("conversation computer review router", function _Suite()
{
	const resolveReview = vi.fn();
	const fetchReview = vi.fn();
	const warn = vi.fn();
	const principal = { externalSubject: "subject-1", principalId: "principal-1", siloId: "silo-1" };
	const active = { leaseId: "lease-secret", sandboxId: "sandbox-one", serviceFQDN: "sandbox-one.computer-ns.svc.cluster.local" };

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
		const router = _CreateConversationComputerReviewRouter({ authority: { resolve: resolveReview }, sandboxNamespace: "computer-ns", fetch: fetchReview, logger: { warn } }, resolve);
		app.use("/api/v1/me/conversations", router);
		return app;
	}

	it("derives the active sandbox host and lease credential after participant admission", async function _DerivesRoute()
	{
		const response = await request(_App()).get("/api/v1/me/conversations/conversation-1/review/files?path=src/main.ts");
		expect(response.status).toBe(200);
		expect(response.text).toBe("selected");
		expect(fetchReview).toHaveBeenCalledWith("http://sandbox-one.computer-ns.svc.cluster.local:8090/v1/files?path=src%2Fmain.ts", expect.objectContaining({ headers: { authorization: "Bearer lease-secret" }, method: "GET", redirect: "manual" }));
		expect(resolveReview).toHaveBeenCalledWith(expect.objectContaining({ principalId: "principal-1" }), "conversation-1", ProductAuthorizationActions.Read);
	});

	it("requires Use authority for a mutating computer command", async function _RequiresUse()
	{
		const response = await request(_App()).post("/api/v1/me/conversations/conversation-1/review/commands").send({ argv: ["git", "status"] });
		expect(response.status).toBe(200);
		expect(resolveReview).toHaveBeenCalledWith(expect.objectContaining({ principalId: "principal-1" }), "conversation-1", ProductAuthorizationActions.Use);
	});

	it("rejects a caller-selected preview port before any upstream exchange", async function _RejectsPort()
	{
		const response = await request(_App()).get("/api/v1/me/conversations/conversation-1/review/previews/9000/index.html");
		expect(response.status).toBe(400);
		expect(fetchReview).not.toHaveBeenCalled();
	});

	it("requires Use and makes hostile localhost HTML inert", async function _MakesPreviewInert()
	{
		fetchReview.mockResolvedValue(new Response("<script>fetch('/api/v1/me')</script>", { status: 200, headers: { "content-type": "text/html" } }));
		const response = await request(_App()).get("/api/v1/me/conversations/conversation-1/review/previews/5173/index.html");
		expect(response.status).toBe(200);
		expect(response.headers["content-type"]).toContain("text/plain");
		expect(response.headers["x-content-type-options"]).toBe("nosniff");
		expect(response.headers["content-security-policy"]).toContain("default-src 'none'");
		expect(resolveReview).toHaveBeenCalledWith(expect.objectContaining({ principalId: "principal-1" }), "conversation-1", ProductAuthorizationActions.Use);
	});

	it("proxies only the fixed browser discovery path", async function _BrowserRoute()
	{
		const response = await request(_App()).get("/api/v1/me/conversations/conversation-1/review/browser/version");
		expect(response.status).toBe(200);
		expect(fetchReview).toHaveBeenCalledWith("http://sandbox-one.computer-ns.svc.cluster.local:8090/v1/browser/version", expect.objectContaining({ method: "GET" }));
	});

	it("rejects a controller Service outside the configured sandbox namespace", async function _RejectsForeignService()
	{
		resolveReview.mockResolvedValue({ leaseId: "lease-secret", sandboxId: "sandbox-one", serviceFQDN: "sandbox-one.foreign.svc.cluster.local" });
		const response = await request(_App()).get("/api/v1/me/conversations/conversation-1/review/files?path=README.md");
		expect(response.status).toBe(503);
		expect(fetchReview).not.toHaveBeenCalled();
		expect(warn).toHaveBeenCalledWith(expect.objectContaining({ err: expect.any(Error), conversationId: "conversation-1", reviewAction: ProductAuthorizationActions.Read, reviewMethod: "GET" }), "Conversation computer review request failed");
		expect(warn.mock.calls[0]?.[0]).not.toHaveProperty("leaseId");
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
