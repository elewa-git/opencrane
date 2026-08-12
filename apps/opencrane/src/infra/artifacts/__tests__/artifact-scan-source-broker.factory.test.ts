import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { __VerifyArtifactReadLease, type ArtifactReadLeaseClaims } from "@opencrane/backend/artifacts/authorization";

import { _CreateArtifactScanSourceBroker } from "../artifact-scan-source-broker.factory.js";

/** Same-silo ArtifactStore origin accepted by the broker configuration guard. */
const _SERVICE_URL = "http://opencrane-artifact-service.default.svc.cluster.local:8080";

describe("artifact scan source broker composition", function _Suite()
{
	afterEach(function _RestoreGlobals()
	{
		vi.unstubAllGlobals();
		vi.useRealTimers();
	});

	it("signs the database-capped lease and cross-checks immutable source metadata", async function _ReadsExactSource()
	{
		const now = new Date("2026-08-11T21:00:00.000Z");
		const directory = mkdtempSync(join(tmpdir(), "opencrane-scan-read-"));
		const keyPath = join(directory, "lease.pem");
		const keys = generateKeyPairSync("ed25519");
		const privateKey = keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
		const publicKey = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
		writeFileSync(keyPath, privateKey, "utf8");
		vi.useFakeTimers();
		vi.setSystemTime(now);
		try
		{
			const readLease: ArtifactReadLeaseClaims = { leaseId: "read-1", siloId: "silo-1", artifactId: "artifact-1", artifactRevisionId: "revision-1", contentAddress: `sha256:${"a".repeat(64)}`, byteLength: 3, mediaType: "image/png", action: "artifact.read", expiresAtEpochSeconds: Math.floor(now.getTime() / 1_000) + 30 };
			const fetchMock = vi.fn().mockResolvedValue(new Response("png", { status: 200, headers: { "content-length": "3", "content-type": "image/png" } }));
			vi.stubGlobal("fetch", fetchMock);

			const broker = _CreateArtifactScanSourceBroker({ ARTIFACT_SERVICE_URL: _SERVICE_URL, ARTIFACT_LEASE_PRIVATE_KEY_PATH: keyPath });
			await expect(broker.open({ readLease, byteLength: 3, mediaType: "image/png" })).resolves.toBeDefined();

			const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
			const compactLease = (request.headers as Record<string, string>)["x-opencrane-artifact-read-lease"] ?? "";
			expect(__VerifyArtifactReadLease(compactLease, publicKey, Math.floor(now.getTime() / 1_000))).toMatchObject({ artifactRevisionId: "revision-1", expiresAtEpochSeconds: readLease.expiresAtEpochSeconds });
		}
		finally
		{
			rmSync(directory, { recursive: true, force: true });
		}
	});

	it("refuses expired authority before contacting ArtifactStore", async function _RejectsExpiredSource()
	{
		const now = new Date("2026-08-11T21:00:00.000Z");
		const directory = mkdtempSync(join(tmpdir(), "opencrane-scan-read-"));
		const keyPath = join(directory, "lease.pem");
		const privateKey = generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" }).toString();
		writeFileSync(keyPath, privateKey, "utf8");
		vi.useFakeTimers();
		vi.setSystemTime(now);
		try
		{
			const readLease: ArtifactReadLeaseClaims = { leaseId: "read-1", siloId: "silo-1", artifactId: "artifact-1", artifactRevisionId: "revision-1", contentAddress: `sha256:${"a".repeat(64)}`, byteLength: 3, mediaType: "image/png", action: "artifact.read", expiresAtEpochSeconds: Math.floor(now.getTime() / 1_000) };
			const fetchMock = vi.fn();
			vi.stubGlobal("fetch", fetchMock);
			const broker = _CreateArtifactScanSourceBroker({ ARTIFACT_SERVICE_URL: _SERVICE_URL, ARTIFACT_LEASE_PRIVATE_KEY_PATH: keyPath });

			await expect(broker.open({ readLease, byteLength: 3, mediaType: "image/png" })).rejects.toThrow(/expired/);
			expect(fetchMock).not.toHaveBeenCalled();
		}
		finally
		{
			rmSync(directory, { recursive: true, force: true });
		}
	});
});
