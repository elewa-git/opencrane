import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import type { Logger } from "@opencrane/backend/observability";

import { __CreateDeferredToolApprovalRouter } from "../deferred-tool-approval.router.js";
import type { DeferredToolApprovalRouterDependencies } from "../deferred-tool-approval.router.types.js";
import { DeferredToolApprovalStates, DeferredToolDecisionKinds } from "../deferred-tool-approval.types.js";

/** Build router ports with one authenticated owner and observable decision persistence. */
function _dependencies(overrides: Partial<DeferredToolApprovalRouterDependencies> = {}): DeferredToolApprovalRouterDependencies
{
	return {
		resolveCaller: function _caller() { return { siloId: "silo-1", subjectId: "user-1" }; },
		decisions: { decideAtomically: vi.fn().mockResolvedValue({ outcome: "approved", argumentsDigest: "sha256:args" }) },
		pendingApprovals: { listPendingOwned: vi.fn().mockResolvedValue([]), listPendingOwnedForConversation: vi.fn().mockResolvedValue([]), readOwned: vi.fn().mockResolvedValue(null) },
		clock: { now: function _now() { return new Date("2026-07-26T12:00:00.000Z"); } },
		logger: { error: vi.fn() } as unknown as Logger,
		...overrides,
	};
}

/** Mount the router below its public self-approval prefix. */
function _app(dependencies: DeferredToolApprovalRouterDependencies)
{
	const app = express();
	app.use(express.json());
	app.use("/api/v1/me/approvals", __CreateDeferredToolApprovalRouter(dependencies));
	return app;
}

describe("__CreateDeferredToolApprovalRouter", function _suite()
{
	it("requires session-derived ownership before deciding an approval", async function _requiresCaller()
	{
		const response = await request(_app(_dependencies({ resolveCaller: function _none() { return null; } }))).post("/api/v1/me/approvals/approval-1/decision").send({ decision: "approved" });
		expect(response.status).toBe(401);
		expect(response.body).toEqual({ error: "approval_authentication_required" });
	});

	it("requires session-derived ownership before listing approvals", async function _requiresCallerToList()
	{
		const response = await request(_app(_dependencies({ resolveCaller: function _none() { return null; } }))).get("/api/v1/me/approvals/");
		expect(response.status).toBe(401);
		expect(response.body).toEqual({ error: "approval_authentication_required" });
	});

	it("lists only the pending approvals returned for the session-derived owner", async function _listsPending()
	{
		const approval = { approvalRequestId: "approval-1", runId: "run-1", attempt: 2, toolRevisionId: "tool-revision-1", toolInvocationId: "call-1", state: DeferredToolApprovalStates.Pending, proposedArguments: { query: "safe" }, responseSchema: { type: "object" }, expiresAt: "2026-07-26T13:00:00.000Z", createdAt: "2026-07-26T12:00:00.000Z" };
		const dependencies = _dependencies({ pendingApprovals: { listPendingOwned: vi.fn().mockResolvedValue([approval]), listPendingOwnedForConversation: vi.fn().mockResolvedValue([approval]), readOwned: vi.fn().mockResolvedValue(approval) } });
		const response = await request(_app(dependencies)).get("/api/v1/me/approvals/");
		expect(response.status).toBe(200);
		expect(response.body).toEqual({ approvals: [approval] });
		expect(dependencies.pendingApprovals.listPendingOwned).toHaveBeenCalledWith("silo-1", "user-1", new Date("2026-07-26T12:00:00.000Z"));

		const detail = await request(_app(dependencies)).get("/api/v1/me/approvals/approval-1");
		expect(detail.status).toBe(200);
		expect(detail.body).toEqual({ approval });
		expect(dependencies.pendingApprovals.readOwned).toHaveBeenCalledWith("approval-1", "silo-1", "user-1", new Date("2026-07-26T12:00:00.000Z"));
	});

	it("passes only the server-derived owner and complete replacement arguments to persistence", async function _approves()
	{
		const dependencies = _dependencies();
		const response = await request(_app(dependencies)).post("/api/v1/me/approvals/approval-1/decision").send({ decision: "approved", arguments: { query: "edited" }, subjectId: "forged" });
		expect(response.status).toBe(400);
		expect(dependencies.decisions.decideAtomically).not.toHaveBeenCalled();

		const accepted = await request(_app(dependencies)).post("/api/v1/me/approvals/approval-1/decision").send({ decision: "approved", arguments: { query: "edited" } });
		expect(accepted.status).toBe(200);
		expect(accepted.body).toEqual({ approvalRequestId: "approval-1", state: "approved" });
		expect(dependencies.decisions.decideAtomically).toHaveBeenCalledWith(expect.objectContaining({ approvalRequestId: "approval-1", siloId: "silo-1", subjectId: "user-1", decidedBy: "user-1", decision: DeferredToolDecisionKinds.Approved, arguments: { query: "edited" } }));
	});

	it("returns the durable terminal decision on an idempotent retry", async function _replays()
	{
		const response = await request(_app(_dependencies({ decisions: { decideAtomically: vi.fn().mockResolvedValue({ outcome: "already_decided", decision: DeferredToolDecisionKinds.Denied }) } }))).post("/api/v1/me/approvals/approval-1/decision").send({ decision: "denied" });
		expect(response.status).toBe(200);
		expect(response.body).toEqual({ approvalRequestId: "approval-1", state: "denied" });
	});

	it("makes an expired approval actionable by nobody", async function _expires()
	{
		const response = await request(_app(_dependencies({ decisions: { decideAtomically: vi.fn().mockResolvedValue({ outcome: "expired" }) } }))).post("/api/v1/me/approvals/approval-1/decision").send({ decision: "approved", arguments: { query: "edited" } });
		expect(response.status).toBe(409);
		expect(response.body).toEqual({ error: "approval_expired" });
	});

	it("rejects incomplete approval replacements and maps schema validation failures", async function _rejectsInvalidArguments()
	{
		const dependencies = _dependencies({ decisions: { decideAtomically: vi.fn().mockResolvedValue({ outcome: "invalid_arguments" }) } });
		expect((await request(_app(dependencies)).post("/api/v1/me/approvals/approval-1/decision").send({ decision: "approved" })).status).toBe(400);
		const rejected = await request(_app(dependencies)).post("/api/v1/me/approvals/approval-1/decision").send({ decision: "approved", arguments: { query: "partial" } });
		expect(rejected.status).toBe(400);
		expect(rejected.body).toEqual({ error: "invalid_approval_arguments" });
	});
});
