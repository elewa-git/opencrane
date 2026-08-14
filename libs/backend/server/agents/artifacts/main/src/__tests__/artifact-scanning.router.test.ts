import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { ARTIFACT_SCANNER_PROJECTED_TOKEN_AUDIENCE, ARTIFACT_SCANNER_SERVICE_ACCOUNT_NAME, ArtifactScannerVerdict } from "@opencrane/contracts";

import { __CreateArtifactScannerRouter } from "../artifact-scanning.router";
import type { ArtifactScannerRouterDependencies } from "../artifact-scanning.types";

/** Fixed isolated scanner namespace used by reviewed test identities. */
const _NAMESPACE = "opencrane-artifact-scanning";

/** Build router dependencies with one exact reviewed scanner identity. */
function _Dependencies(overrides: Partial<ArtifactScannerRouterDependencies> = {}): ArtifactScannerRouterDependencies
{
	return {
		authority: { claim: vi.fn().mockResolvedValue(null), readSource: vi.fn().mockResolvedValue(null), complete: vi.fn().mockResolvedValue("completed"), fail: vi.fn().mockResolvedValue("failed") },
		tokenReviewer: { __Review: vi.fn().mockResolvedValue({ username: `system:serviceaccount:${_NAMESPACE}:${ARTIFACT_SCANNER_SERVICE_ACCOUNT_NAME}`, namespace: _NAMESPACE, serviceAccountName: ARTIFACT_SCANNER_SERVICE_ACCOUNT_NAME, audiences: [ARTIFACT_SCANNER_PROJECTED_TOKEN_AUDIENCE] }) },
		sourceBroker: { open: vi.fn() },
		expectedNamespace: _NAMESPACE,
		logger: { error: vi.fn() },
		...overrides,
	};
}

/** Mount the scanner router behind the production JSON parser and internal path. */
function _App(dependencies: ArtifactScannerRouterDependencies)
{
	const app = express();
	app.use(express.json());
	app.use("/api/internal/artifact-scanner", __CreateArtifactScannerRouter(dependencies));
	return app;
}

/** Standard test authorization header carrying no real credential. */
function _Authorization(): { readonly authorization: string }
{
	return { authorization: "Bearer projected-token" };
}

describe("artifact scanner broker router", function _Suite()
{
	it("returns only fenced scan work metadata", async function _Claims()
	{
		const authority = _Dependencies().authority;
		vi.mocked(authority.claim).mockResolvedValue({ lease: { jobId: "job-1", attempt: 1, claimFence: "fence-1", expiresAt: "2026-08-11T21:00:00.000Z" }, sourceByteLength: 3 });
		const response = await request(_App(_Dependencies({ authority }))).post("/api/internal/artifact-scanner/jobs:claim").set(_Authorization()).send({});

		expect(response.status).toBe(200);
		expect(response.body).toEqual({ lease: { jobId: "job-1", attempt: 1, claimFence: "fence-1", expiresAt: "2026-08-11T21:00:00.000Z" }, sourceByteLength: 3 });
		expect(JSON.stringify(response.body)).not.toMatch(/address|token|capability|store/iu);
	});

	it("streams bytes only after the live fence allocates a server-only read projection", async function _ReadsSource()
	{
		const source = { readLease: { leaseId: "read-1", siloId: "silo-1", artifactId: "artifact-1", artifactRevisionId: "revision-1", contentAddress: `sha256:${"a".repeat(64)}`, byteLength: 3, mediaType: "image/png", action: "artifact.read" as const, expiresAtEpochSeconds: 1_800_000_000 }, mediaType: "image/png", byteLength: 3 };
		const authority = _Dependencies().authority;
		const open = vi.fn().mockResolvedValue(_Bytes("png"));
		vi.mocked(authority.readSource).mockResolvedValue(source);

		const response = await request(_App(_Dependencies({ authority, sourceBroker: { open } }))).post("/api/internal/artifact-scanner/jobs/job-1/source").set(_Authorization()).set("x-opencrane-scan-attempt", "2").set("x-opencrane-scan-fence", "fence-2").send({});

		expect(response.status).toBe(200);
		expect(response.body).toEqual(Buffer.from("png"));
		expect(authority.readSource).toHaveBeenCalledWith({ jobId: "job-1", attempt: 2, claimFence: "fence-2" });
		expect(open).toHaveBeenCalledWith(source);
	});

	it("accepts one clean result under the exact fence", async function _Completes()
	{
		const authority = _Dependencies().authority;
		const response = await request(_App(_Dependencies({ authority }))).put("/api/internal/artifact-scanner/jobs/job-1/result").set(_Authorization()).send({ attempt: 2, claimFence: "fence-2", verdict: ArtifactScannerVerdict.Clean, scannerVersion: "clamav-pinned" });

		expect(response.status).toBe(204);
		expect(authority.complete).toHaveBeenCalledWith({ jobId: "job-1", attempt: 2, claimFence: "fence-2", verdict: ArtifactScannerVerdict.Clean, scannerVersion: "clamav-pinned" });
	});

	it.each([
		["missing token", undefined, null],
		["wrong namespace", "Bearer projected-token", { username: `system:serviceaccount:other:${ARTIFACT_SCANNER_SERVICE_ACCOUNT_NAME}`, namespace: "other", serviceAccountName: ARTIFACT_SCANNER_SERVICE_ACCOUNT_NAME, audiences: [ARTIFACT_SCANNER_PROJECTED_TOKEN_AUDIENCE] }],
		["wrong ServiceAccount", "Bearer projected-token", { username: `system:serviceaccount:${_NAMESPACE}:other`, namespace: _NAMESPACE, serviceAccountName: "other", audiences: [ARTIFACT_SCANNER_PROJECTED_TOKEN_AUDIENCE] }],
		["wrong username", "Bearer projected-token", { username: `system:serviceaccount:other:${ARTIFACT_SCANNER_SERVICE_ACCOUNT_NAME}`, namespace: _NAMESPACE, serviceAccountName: ARTIFACT_SCANNER_SERVICE_ACCOUNT_NAME, audiences: [ARTIFACT_SCANNER_PROJECTED_TOKEN_AUDIENCE] }],
		["wrong audience", "Bearer projected-token", { username: `system:serviceaccount:${_NAMESPACE}:${ARTIFACT_SCANNER_SERVICE_ACCOUNT_NAME}`, namespace: _NAMESPACE, serviceAccountName: ARTIFACT_SCANNER_SERVICE_ACCOUNT_NAME, audiences: ["another-audience"] }],
	])("fails closed for %s without consulting durable authority", async function _RejectsIdentity(_case, authorization, identity)
	{
		const authority = _Dependencies().authority;
		const tokenReviewer = { __Review: vi.fn().mockResolvedValue(identity) };
		const pending = request(_App(_Dependencies({ authority, tokenReviewer }))).post("/api/internal/artifact-scanner/jobs:claim");
		if (authorization !== undefined) pending.set("authorization", authorization);
		const response = await pending.send({});

		expect(response.status).toBe(401);
		expect(authority.claim).not.toHaveBeenCalled();
	});
});

/** Yield one UTF-8 test body through the byte-broker stream contract. */
async function* _Bytes(value: string): AsyncGenerator<Uint8Array>
{
	yield Buffer.from(value);
}
