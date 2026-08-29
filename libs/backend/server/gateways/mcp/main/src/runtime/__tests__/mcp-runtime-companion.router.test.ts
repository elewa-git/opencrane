import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { McpCompanionCommandKinds, McpCompanionFailureCodes } from "@opencrane/backend/agents/runtime/mcp-executor/companion";

import { __CreateMcpRuntimeCompanionRouter } from "../mcp-runtime-companion.router";
import { McpRuntimeCompanionClaimOutcomes, type McpRuntimeCompanionRouterDependencies } from "../mcp-runtime.types";

/** Kubernetes-reviewed identity bound to the projected companion token. */
const _IDENTITY = { subject: "system:serviceaccount:mcp-executor:mcp-executor-default", namespace: "mcp-executor", serviceAccountName: "mcp-executor-default", podUid: "pod-uid-1" };

/** Exact projected companion claim request. */
const _CLAIM = { executionReference: "execution-reference-1", podUid: "pod-uid-1" };

/** Current terminal fence shared by completion and failure. */
const _TERMINAL = { ..._CLAIM, executionId: "execution-1", claimFence: "claim-fence-1" };

/** Build companion router ports with observable authority methods. */
function _Dependencies(overrides: Partial<McpRuntimeCompanionRouterDependencies> = {}): McpRuntimeCompanionRouterDependencies
{
	return {
		authority: {
			claimCompanion: vi.fn().mockResolvedValue(null),
			completeCompanion: vi.fn().mockResolvedValue("completed"),
			failCompanion: vi.fn().mockResolvedValue("failed"),
		},
		tokenReviewer: { __Review: vi.fn().mockResolvedValue(_IDENTITY) },
		logger: { error: vi.fn() },
		...overrides,
	} as never;
}

/** Mount the companion router at its exact internal endpoint. */
function _App(dependencies: McpRuntimeCompanionRouterDependencies)
{
	const app = express();
	app.use(express.json());
	app.use("/api/internal/mcp-executor", __CreateMcpRuntimeCompanionRouter(dependencies));
	return app;
}

/** Add the projected Pod credential to one internal request. */
function _Token(value: request.Test): request.Test
{
	return value.set("authorization", "Bearer companion-token");
}

describe("MCP runtime companion router", function _DescribeRouter()
{
	it("authenticates before parsing any companion body", async function _AuthenticatesBeforeParse()
	{
		const dependencies = _Dependencies({ tokenReviewer: { __Review: vi.fn().mockResolvedValue(null) } });
		const response = await _Token(request(_App(dependencies)).post("/api/internal/mcp-executor/claim")).send({ attacker: "probe" });

		expect(response.status).toBe(401);
		expect(dependencies.authority.claimCompanion).not.toHaveBeenCalled();
	});

	it("binds the request Pod UID to the UID returned by TokenReview", async function _BindsPodUid()
	{
		const dependencies = _Dependencies();
		const response = await _Token(request(_App(dependencies)).post("/api/internal/mcp-executor/claim")).send({ ..._CLAIM, podUid: "attacker-pod" });

		expect(response.status).toBe(401);
		expect(dependencies.authority.claimCompanion).not.toHaveBeenCalled();
	});

	it("returns the server-selected claim for the reviewed workload identity", async function _Claims()
	{
		const claim = { kind: McpCompanionCommandKinds.Discovery, executionId: "execution-1", claimFence: "claim-fence-1", expiresAt: "2999-01-01T00:00:00.000Z" };
		const claimCompanion = vi.fn().mockResolvedValue(claim);
		const dependencies = _Dependencies({ authority: { claimCompanion } as never });
		const response = await _Token(request(_App(dependencies)).post("/api/internal/mcp-executor/claim")).send(_CLAIM);

		expect(response.status).toBe(200);
		expect(response.body).toEqual(claim);
		expect(claimCompanion).toHaveBeenCalledWith(_IDENTITY, "execution-reference-1");
	});

	it("returns no content for an idle Pod and accepted terminal reports", async function _HandlesNormalOutcomes()
	{
		const authority = { claimCompanion: vi.fn().mockResolvedValue(null), completeCompanion: vi.fn().mockResolvedValue("idempotent"), failCompanion: vi.fn().mockResolvedValue("failed") };
		const app = _App(_Dependencies({ authority: authority as never }));
		const completion = { ..._TERMINAL, completion: { kind: McpCompanionCommandKinds.Discovery, tools: [] } };
		const failure = { ..._TERMINAL, failureCode: McpCompanionFailureCodes.DiscoveryFailed };

		expect((await _Token(request(app).post("/api/internal/mcp-executor/claim")).send(_CLAIM)).status).toBe(204);
		expect((await _Token(request(app).post("/api/internal/mcp-executor/complete")).send(completion)).status).toBe(204);
		expect((await _Token(request(app).post("/api/internal/mcp-executor/fail")).send(failure)).status).toBe(204);
		expect(authority.completeCompanion).toHaveBeenCalledWith(_IDENTITY, completion);
		expect(authority.failCompanion).toHaveBeenCalledWith(_IDENTITY, failure);
	});

	it("tells the companion to stop when the saved invocation ended before dispatch", async function _StopsTerminalWork()
	{
		const dependencies = _Dependencies({ authority: { claimCompanion: vi.fn().mockResolvedValue(McpRuntimeCompanionClaimOutcomes.Terminal) } as never });
		const response = await _Token(request(_App(dependencies)).post("/api/internal/mcp-executor/claim")).send(_CLAIM);
		expect(response.status).toBe(410);
	});

	it("returns conflict for a stale terminal fence", async function _RejectsConflict()
	{
		const dependencies = _Dependencies({ authority: { completeCompanion: vi.fn().mockResolvedValue("conflict") } as never });
		const completion = { ..._TERMINAL, completion: { kind: McpCompanionCommandKinds.Discovery, tools: [] } };
		const response = await _Token(request(_App(dependencies)).post("/api/internal/mcp-executor/complete")).send(completion);

		expect(response.status).toBe(409);
	});

	it("logs TokenReview outages without Pod credentials or MCP content", async function _HandlesReviewOutage()
	{
		const logger = { error: vi.fn() };
		const dependencies = _Dependencies({ tokenReviewer: { __Review: vi.fn().mockRejectedValue(new Error("Kubernetes unavailable")) }, logger: logger as never });
		const response = await _Token(request(_App(dependencies)).post("/api/internal/mcp-executor/claim")).send({ ..._CLAIM, secret: "body-secret" });

		expect(response.status).toBe(503);
		expect(JSON.stringify(logger.error.mock.calls)).not.toContain("companion-token");
		expect(JSON.stringify(logger.error.mock.calls)).not.toContain("body-secret");
	});
});
