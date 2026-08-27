import type { PrismaClient } from "@prisma/client";
import type { AuthenticationV1Api } from "@kubernetes/client-node";
import type { NextFunction, Request, Response } from "express";
import request from "supertest";
import { Router } from "express";
import { describe, expect, it, vi } from "vitest";

import { _CreateInternalApp } from "../internal-app";
import type { InternalRuntimeConfig } from "../config.types";
import type { McpRuntimeComposition } from "../mcp-runtime-composition.types";

/** Keep parser tests independent from mounted ArtifactStore credentials. */
vi.mock("../../infra/artifacts/artifact-upload.factory", function _MockArtifactUploadFactory()
{
	return {
		_CreateArtifactPreprocessOutputBroker: function _CreateArtifactPreprocessOutputBroker() { return {}; },
		_CreateConversationAssetOutputAuthority: function _CreateConversationAssetOutputAuthority() { return { reserve: vi.fn(), publish: vi.fn() }; },
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
		assignmentTtlMilliseconds: 60_000,
		channelTargets: null,
		claimLeaseMilliseconds: 30_000,
		commandRecoveryMilliseconds: 15_000,
		commandTtlMilliseconds: 60_000,
		managedRuntimeNamespace: "managed-runtime",
		mcpCompanionClaimLeaseMilliseconds: 30_000,
		mcpControllerClaimLeaseMilliseconds: 30_000,
		mcpExecutorNamespace: "mcp-executors",
		memoryGatewayTimeoutMilliseconds: 30_000,
		memoryGatewayTokenPath: "/var/run/opencrane/memory-gateway/token",
		memoryGatewayUrl: "http://opencrane-memory-gateway.default.svc.cluster.local:8080",
		personalRuntimeNamespace: "personal-runtime",
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

/** Continue the request through the session-middleware seam without adding authentication state. */
function _Continue(_request: Request, _response: Response, next: NextFunction): void { next(); }

describe("internal workload app", function _Suite()
{
	it("rejects scanner JSON above the private command ceiling before route dispatch", async function _RejectsLargeScannerCommand()
	{
		const app = _CreateInternalApp({} as PrismaClient, {} as AuthenticationV1Api, _RuntimeConfig(), [_Continue], _McpRuntime());
		const response = await request(app).put("/api/internal/artifact-scanner/jobs/job-1/result").set("content-type", "application/json").send({ scannerVersion: "x".repeat(20 * 1_024) });

		expect(response.status).toBe(413);
	});
});
