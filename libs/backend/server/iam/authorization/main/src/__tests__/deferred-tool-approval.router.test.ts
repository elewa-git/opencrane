import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import type { Logger } from "@opencrane/observability";

import { __CreateDeferredToolApprovalRouter } from "../deferred-tool-approval.router.js";
import type { DeferredToolApprovalRouterDependencies } from "../deferred-tool-approval.router.types.js";

/** Build router ports with one authenticated owner and observable decision persistence. */
function _dependencies(overrides: Partial<DeferredToolApprovalRouterDependencies> = {}): DeferredToolApprovalRouterDependencies
{
	return {
		resolveCaller: function _caller() { return { siloId: "silo-1", subjectId: "user-1" }; },
		decisions: { decideAtomically: vi.fn().mockResolvedValue({ outcome: "approved", deferredToolResult: { approvalRequestId: "approval-1", decision: "approved" } }) },
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

	it("passes only the server-derived owner and a server-minted resume marker to persistence", async function _approves()
	{
		const dependencies = _dependencies();
		const response = await request(_app(dependencies)).post("/api/v1/me/approvals/approval-1/decision").send({ decision: "approved", subjectId: "forged", deferredToolResult: { forged: true } });
		expect(response.status).toBe(400);
		expect(dependencies.decisions.decideAtomically).not.toHaveBeenCalled();

		const accepted = await request(_app(dependencies)).post("/api/v1/me/approvals/approval-1/decision").send({ decision: "approved" });
		expect(accepted.status).toBe(200);
		expect(accepted.body).toEqual({ approvalRequestId: "approval-1", state: "approved" });
		expect(dependencies.decisions.decideAtomically).toHaveBeenCalledWith(expect.objectContaining({ approvalRequestId: "approval-1", siloId: "silo-1", subjectId: "user-1", decidedBy: "user-1", decision: "approved", deferredToolResult: { approvalRequestId: "approval-1", decision: "approved" }, resumeTokenHash: expect.stringMatching(/^sha256:/) }));
	});

	it("returns the durable terminal decision on an idempotent retry", async function _replays()
	{
		const response = await request(_app(_dependencies({ decisions: { decideAtomically: vi.fn().mockResolvedValue({ outcome: "already_decided", decision: "denied" }) } }))).post("/api/v1/me/approvals/approval-1/decision").send({ decision: "denied" });
		expect(response.status).toBe(200);
		expect(response.body).toEqual({ approvalRequestId: "approval-1", state: "denied" });
	});

	it("makes an expired approval actionable by nobody", async function _expires()
	{
		const response = await request(_app(_dependencies({ decisions: { decideAtomically: vi.fn().mockResolvedValue({ outcome: "expired" }) } }))).post("/api/v1/me/approvals/approval-1/decision").send({ decision: "approved" });
		expect(response.status).toBe(409);
		expect(response.body).toEqual({ error: "approval_expired" });
	});
});
