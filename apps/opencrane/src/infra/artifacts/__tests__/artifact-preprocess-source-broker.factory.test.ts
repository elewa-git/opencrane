import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { __VerifyArtifactReadLease } from "@opencrane/backend/artifacts/authorization";
import { afterEach, describe, expect, it, vi } from "vitest";

import { _CreateArtifactPreprocessSourceBroker } from "../artifact-preprocess-source-broker.factory.js";

/** Same-silo artifact-service origin accepted by the broker configuration guard. */
const _serviceUrl = "http://opencrane-artifact-service.default.svc.cluster.local:8080";

describe("artifact preprocess source broker composition", function _suite()
{
	afterEach(function _restoreFetch()
	{
		vi.unstubAllGlobals();
		vi.useRealTimers();
	});

	it.each([
		["claim expiry", 1_000, 1_000],
		["early-failure retry", 5 * 60_000, 30_000],
	])("caps a preprocessing source lease for %s before a reclaimed attempt may read", async function _CapsPreprocessLease(_case, claimLifetimeMilliseconds, expectedLeaseMilliseconds)
	{
		const now = new Date("2026-07-26T15:00:00.000Z");
		const claimExpiresAt = new Date(now.getTime() + claimLifetimeMilliseconds);
		const expectedLeaseExpiry = new Date(now.getTime() + expectedLeaseMilliseconds);
		const directory = mkdtempSync(join(tmpdir(), "opencrane-preprocess-read-"));
		const keyPath = join(directory, "lease.pem");
		const keys = generateKeyPairSync("ed25519");
		const privateKey = keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
		const publicKey = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
		writeFileSync(keyPath, privateKey, "utf8");
		vi.useFakeTimers();
		vi.setSystemTime(now);
		try
		{
			const transaction = {
				$queryRaw: vi.fn().mockResolvedValue([{ now }]),
				artifactPreprocessJob: {
					findUnique: vi.fn().mockResolvedValue({
						state: "Claimed",
						attempt: 2,
						claimFence: "fence-2",
						claimExpiresAt,
						pipelineVersion: "pdf-to-text/v1",
						sourceRevision: {
							id: "revision-1",
							artifactId: "artifact-1",
							state: "Published",
							contentAddress: `sha256:${"a".repeat(64)}`,
							byteLength: 3n,
							mediaType: "application/pdf",
							artifact: { siloId: "silo-1", state: "Active" },
						},
					}),
				},
			};
			const prisma = { $transaction: vi.fn(async function _Transaction(callback: (client: typeof transaction) => Promise<unknown>) { return callback(transaction); }) } as never;
			const fetchMock = vi.fn().mockResolvedValue(new Response("pdf", { status: 200, headers: { "content-length": "3", "content-type": "application/pdf" } }));
			vi.stubGlobal("fetch", fetchMock);

			const broker = _CreateArtifactPreprocessSourceBroker(prisma, { ARTIFACT_SERVICE_URL: _serviceUrl, ARTIFACT_LEASE_PRIVATE_KEY_PATH: keyPath });
			await expect(broker.read({ jobId: "job-1", attempt: 2, claimFence: "fence-2" })).resolves.toMatchObject({ byteLength: 3, mediaType: "application/pdf" });

			const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
			const compactLease = (request.headers as Record<string, string>)["x-opencrane-artifact-read-lease"] ?? "";
			expect(__VerifyArtifactReadLease(compactLease, publicKey, Math.floor(now.getTime() / 1_000))).toMatchObject({ artifactRevisionId: "revision-1", expiresAtEpochSeconds: Math.floor(expectedLeaseExpiry.getTime() / 1_000) });
			expect(__VerifyArtifactReadLease(compactLease, publicKey, Math.floor(expectedLeaseExpiry.getTime() / 1_000))).toBeNull();
			expect(transaction.$queryRaw).toHaveBeenCalledTimes(2);
		}
		finally
		{
			rmSync(directory, { recursive: true, force: true });
		}
	});

	it("fails before reading key material when the artifact service is not a same-silo HTTP endpoint", function _RejectsExternalService()
	{
		expect(function _create() { _CreateArtifactPreprocessSourceBroker({} as never, { ARTIFACT_SERVICE_URL: "https://artifact.example.test", ARTIFACT_LEASE_PRIVATE_KEY_PATH: "/does-not-exist" }); }).toThrow(/credential-free cluster-local HTTP URL/);
	});
});
