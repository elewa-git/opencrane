import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { AGENT_CONTROLLER_PROJECTED_TOKEN_AUDIENCE } from "@opencrane/contracts";

import { __CreateMcpRuntimeControllerRouter } from "../mcp-runtime-controller.router";
import type { McpRuntimeControllerRouterDependencies } from "../mcp-runtime.types";

/** Exact TokenReview identity admitted for the fixed controller deployment. */
const _CONTROLLER_IDENTITY = { username: "system:serviceaccount:silo-a:agent-controller", namespace: "silo-a", serviceAccountName: "agent-controller", audiences: [AGENT_CONTROLLER_PROJECTED_TOKEN_AUDIENCE] };

/** Valid assignment evidence emitted after Kubernetes creates the suspended Job. */
const _ASSIGNMENT = { claimId: "claim-1", claimedAt: "2026-08-27T00:00:00.000Z", deliveryCount: 1, profileName: "mcp-default", workloadUid: "job-uid-1" };

/** Valid release evidence tied to the current database delivery fence. */
const _RELEASE = { releaseClaimedAt: "2026-08-27T00:01:00.000Z", releaseDeliveryCount: 1, workloadUid: "job-uid-1" };

/** Build all controller router ports with observable defaults. */
function _Dependencies(overrides: Partial<McpRuntimeControllerRouterDependencies> = {}): McpRuntimeControllerRouterDependencies
{
	return {
		authority: {
			claimNextController: vi.fn().mockResolvedValue(null),
			commitAssignment: vi.fn().mockResolvedValue("assigned"),
			claimNextRelease: vi.fn().mockResolvedValue(null),
			commitRelease: vi.fn().mockResolvedValue("released"),
			registerFirstPod: vi.fn().mockResolvedValue("registered"),
		},
		tokenReviewer: { __Review: vi.fn().mockResolvedValue(_CONTROLLER_IDENTITY) },
		serverNamespace: "silo-a",
		logger: { error: vi.fn() },
		...overrides,
	} as never;
}

/** Mount the controller router beneath its internal listener prefix. */
function _App(dependencies: McpRuntimeControllerRouterDependencies)
{
	const app = express();
	app.use(express.json());
	app.use("/api/internal/agent-controller", __CreateMcpRuntimeControllerRouter(dependencies));
	return app;
}

/** Add the rotating projected controller credential to one request. */
function _Token(value: request.Test): request.Test
{
	return value.set("authorization", "Bearer controller-token");
}

describe("MCP runtime controller router", function _DescribeRouter()
{
	it("requires every field of the fixed controller identity", async function _RejectsWrongIdentity()
	{
		const dependencies = _Dependencies({ tokenReviewer: { __Review: vi.fn().mockResolvedValue({ ..._CONTROLLER_IDENTITY, audiences: ["wrong-audience"] }) } });
		const response = await _Token(request(_App(dependencies)).post("/api/internal/agent-controller/mcp-executor:claim")).send({});

		expect(response.status).toBe(401);
		expect(dependencies.authority.claimNextController).not.toHaveBeenCalled();
	});

	it("authenticates before parsing assignment evidence", async function _AuthenticatesBeforeParse()
	{
		const dependencies = _Dependencies({ tokenReviewer: { __Review: vi.fn().mockResolvedValue(null) } });
		const response = await _Token(request(_App(dependencies)).put("/api/internal/agent-controller/mcp-executor/claim-1/assignment")).send({ attacker: "probe" });

		expect(response.status).toBe(401);
		expect(dependencies.authority.commitAssignment).not.toHaveBeenCalled();
	});

	it("returns no content for empty claim polls and the exact database claim when ready", async function _Claims()
	{
		const claim = { claim: { claimId: "claim-1" }, registryReference: `registry.internal/mcp/server@sha256:${"a".repeat(64)}` };
		const claimNextController = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(claim);
		const app = _App(_Dependencies({ authority: { claimNextController } as never }));

		expect((await _Token(request(app).post("/api/internal/agent-controller/mcp-executor:claim")).send({})).status).toBe(204);
		const response = await _Token(request(app).post("/api/internal/agent-controller/mcp-executor:claim")).send({});
		expect(response.status).toBe(200);
		expect(response.body).toEqual(claim);
	});

	it("serves all assignment and release routes with client-compatible statuses", async function _Writes()
	{
		const authority = {
			claimNextController: vi.fn(),
			commitAssignment: vi.fn().mockResolvedValue("assigned"),
			claimNextRelease: vi.fn().mockResolvedValue(null),
			commitRelease: vi.fn().mockResolvedValue("released"),
			registerFirstPod: vi.fn().mockResolvedValue("registered"),
		};
		const app = _App(_Dependencies({ authority: authority as never }));

		const assigned = await _Token(request(app).put("/api/internal/agent-controller/mcp-executor/claim-1/assignment")).send(_ASSIGNMENT);
		const releasePoll = await _Token(request(app).post("/api/internal/agent-controller/mcp-executor:release-claim")).send({});
		const released = await _Token(request(app).put("/api/internal/agent-controller/mcp-executor/claim-1/release")).send(_RELEASE);
		const registered = await _Token(request(app).put("/api/internal/agent-controller/mcp-executor/claim-1/pod-registration")).send({ ..._RELEASE, podUid: "pod-uid-1" });

		expect(assigned.status).toBe(200);
		expect(assigned.body).toEqual({ outcome: "assigned" });
		expect(releasePoll.status).toBe(204);
		expect(released.body).toEqual({ outcome: "released" });
		expect(registered.body).toEqual({ outcome: "registered" });
		expect(authority.commitAssignment).toHaveBeenCalledWith(_ASSIGNMENT);
		expect(authority.commitRelease).toHaveBeenCalledWith("claim-1", _RELEASE);
		expect(authority.registerFirstPod).toHaveBeenCalledWith("claim-1", { ..._RELEASE, podUid: "pod-uid-1" });
	});

	it("returns conflict without a body shape the controller could accept as success", async function _Conflicts()
	{
		const dependencies = _Dependencies({ authority: { commitAssignment: vi.fn().mockResolvedValue("conflict") } as never });
		const response = await _Token(request(_App(dependencies)).put("/api/internal/agent-controller/mcp-executor/claim-1/assignment")).send(_ASSIGNMENT);

		expect(response.status).toBe(409);
		expect(response.body).toEqual({ error: "stale_or_conflicting_mcp_runtime_write" });
	});

	it("logs TokenReview outages without bearer-token or body data", async function _HandlesReviewOutage()
	{
		const logger = { error: vi.fn() };
		const failure = new Error("Kubernetes API unavailable");
		const dependencies = _Dependencies({ tokenReviewer: { __Review: vi.fn().mockRejectedValue(failure) }, logger: logger as never });
		const response = await _Token(request(_App(dependencies)).post("/api/internal/agent-controller/mcp-executor:claim")).send({ secret: "body-secret" });

		expect(response.status).toBe(503);
		expect(JSON.stringify(logger.error.mock.calls)).not.toContain("controller-token");
		expect(JSON.stringify(logger.error.mock.calls)).not.toContain("body-secret");
	});
});
