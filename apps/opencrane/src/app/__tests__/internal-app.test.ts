import type { PrismaClient } from "@prisma/client";
import type { AuthenticationV1Api } from "@kubernetes/client-node";
import type { NextFunction, Request, Response } from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";

import { __UnavailableMemoryGatewayClient } from "@opencrane/backend/server/infra/memory-gateway-client";

import { _CreateInternalApp } from "../internal-app.js";
import type { InternalRuntimeConfig } from "../config.types.js";

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
		memoryGatewayTimeoutMilliseconds: 30_000,
		memoryGatewayTokenPath: "/var/run/opencrane/memory-gateway/token",
		memoryGatewayUrl: "http://opencrane-memory-gateway.default.svc.cluster.local:8080",
		outboxPruneBatchSize: 100,
		personalRuntimeNamespace: "personal-runtime",
		publishedOutboxRetentionMilliseconds: 86_400_000,
		serverNamespace: "opencrane-server",
	};
}

/** Continue the request through the session-middleware seam without adding authentication state. */
function _Continue(_request: Request, _response: Response, next: NextFunction): void { next(); }

describe("internal workload app", function _Suite()
{
	it("rejects scanner JSON above the private command ceiling before route dispatch", async function _RejectsLargeScannerCommand()
	{
		const app = _CreateInternalApp({} as PrismaClient, {} as AuthenticationV1Api, _RuntimeConfig(), new __UnavailableMemoryGatewayClient(), [_Continue]);
		const response = await request(app).put("/api/internal/artifact-scanner/jobs/job-1/result").set("content-type", "application/json").send({ scannerVersion: "x".repeat(20 * 1_024) });

		expect(response.status).toBe(413);
	});
});
