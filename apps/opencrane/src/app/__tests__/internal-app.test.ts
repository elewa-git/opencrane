import type { PrismaClient } from "@prisma/client";
import type { AuthenticationV1Api } from "@kubernetes/client-node";
import type { Request, Response } from "express";
import request from "supertest";
import { Router } from "express";
import { describe, expect, it, vi } from "vitest";

import { ___GetContext } from "@opencrane/backend/observability";

import { _CreateInternalApp } from "../internal-app";
import type { InternalRuntimeConfig } from "../config.types";
import type { McpRuntimeComposition } from "../mcp-runtime-composition.types";

/** Keep parser tests independent from mounted ArtifactStore credentials. */
vi.mock("../../infra/artifacts/artifact-upload.factory", function _MockArtifactUploadFactory()
{
	return {
		_CreateArtifactPreprocessOutputBroker: function _CreateArtifactPreprocessOutputBroker() { return {}; },
		_CreateSkillAuthoringArtifactReader: function _CreateSkillAuthoringArtifactReader() { return {}; },
	};
});

/** Build valid disabled-worker configuration for transport-parser tests. */
function _RuntimeConfig(): InternalRuntimeConfig
{
	return {
		artifactScannerEnabled: false,
		artifactScannerClaimLeaseMilliseconds: 300_000,
		artifactScannerNamespace: undefined,
		artifactPreprocessorEnabled: false,
		artifactPreprocessorMaximumOutputBytes: 1_024,
		artifactPreprocessorNamespace: undefined,
		mcpCompanionClaimLeaseMilliseconds: 30_000,
		mcpControllerClaimLeaseMilliseconds: 30_000,
		mcpExecutorNamespace: "mcp-executors",
		memoryGatewayTimeoutMilliseconds: 30_000,
		memoryGatewayTokenPath: "/var/run/opencrane/memory-gateway/token",
		memoryGatewayUrl: "http://opencrane-memory-gateway.default.svc.cluster.local:8080",
		serverNamespace: "opencrane-server",
		skillAuthoringNamespace: "skill-authoring",
		siloId: "silo-1",
	};
}

/** Supply inert MCP routers because this test owns only the internal body parser. */
function _McpRuntime(): McpRuntimeComposition
{
	return { authority: {} as McpRuntimeComposition["authority"], promotion: Router(), controller: Router(), companion: Router(), taskWorkflow: {} as McpRuntimeComposition["taskWorkflow"] };
}

describe("internal workload app", function _Suite()
{
	it("rejects scanner JSON above the private command ceiling before route dispatch", async function _RejectsLargeScannerCommand()
	{
		const app = _CreateInternalApp({} as PrismaClient, {} as AuthenticationV1Api, _RuntimeConfig(), _McpRuntime());
		const response = await request(app).put("/api/internal/artifact-scanner/jobs/job-1/result").set("x-request-id", "scanner-parser-request").set("content-type", "application/json").send({ scannerVersion: "x".repeat(20 * 1_024) });

		expect(response.status).toBe(413);
		expect(response.headers["x-request-id"]).toBe("scanner-parser-request");
	});

	it.each([
		{ method: "GET", path: "/review-credential" },
		{ method: "GET", path: "/bootstrap" },
		{ method: "POST", path: "/output" },
		{ method: "POST", path: "/checkpoint/export" },
	])("provides request context and a logger before the early $path handler", async function _EarlyComputerContext({ method, path })
	{
		const turn = Router();
		const checkpoint = Router();
		/** Reports the context and logger visible to a handler before the generic internal routes. */
		function _ObservedRequest(req: Request, res: Response): void
		{
			res.json({ requestId: ___GetContext()?.requestId, loggerRequestId: req.id, hasLogger: typeof req.log?.warn === "function", body: req.body });
		}
		turn.get("/review-credential", _ObservedRequest);
		turn.get("/bootstrap", _ObservedRequest);
		turn.post("/output", _ObservedRequest);
		checkpoint.post("/export", _ObservedRequest);
		const app = _CreateInternalApp({} as PrismaClient, {} as AuthenticationV1Api, _RuntimeConfig(), _McpRuntime(), undefined, turn, checkpoint);
		const pending = method === "GET"
			? request(app).get(`/api/internal/conversation-computer${path}`)
			: request(app).post(`/api/internal/conversation-computer${path}`).send({ text: "private-output" });
		const response = await pending.set("x-request-id", "early-computer-request");

		expect(response.status).toBe(200);
		expect(response.headers["x-request-id"]).toBe("early-computer-request");
		expect(response.body).toMatchObject({ requestId: "early-computer-request", loggerRequestId: "early-computer-request", hasLogger: true });
		if (method === "POST")
			expect(response.body.body).toEqual({ text: "private-output" });
	});
});
