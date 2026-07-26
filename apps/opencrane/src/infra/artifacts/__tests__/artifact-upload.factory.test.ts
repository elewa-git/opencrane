import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { __VerifyArtifactReadLease } from "@opencrane/backend/artifacts/authorization";
import { afterEach, describe, expect, it, vi } from "vitest";

import { _CreateArtifactPreprocessSourceBroker, _CreateArtifactServicePromotionPort, _CreateArtifactServiceReadPort, _CreateArtifactUploadGateway, _CreateSkillAuthoringArtifactReader } from "../artifact-upload.factory.js";

const _serviceUrl = "http://opencrane-artifact-service.default.svc.cluster.local:8080";

async function* _bytes(): AsyncIterable<Uint8Array>
{
	yield Buffer.from("proof-bound artifact");
}

describe("artifact upload app composition", function _suite()
{
	afterEach(function _restoreFetch()
	{
		vi.unstubAllGlobals();
		vi.useRealTimers();
	});

	it("rejects a non-cluster endpoint before it can read mounted credentials or make I/O", function _clusterOnly()
	{
		expect(function _create() { _CreateArtifactUploadGateway({} as never, { ARTIFACT_SERVICE_URL: "https://artifact.example.test" }); }).toThrow(/credential-free cluster-local HTTP URL/);
	});

	it("streams bytes to the private promotion endpoint with the signed lease header", async function _promotionRequest()
	{
		const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ receipt: "service-receipt" }), { status: 201 }));
		vi.stubGlobal("fetch", fetchMock);
		const response = await _CreateArtifactServicePromotionPort(_serviceUrl).promote("signed-lease", _bytes());
		expect(response).toEqual({ receipt: "service-receipt" });
		expect(fetchMock).toHaveBeenCalledWith(`${_serviceUrl}/v1/artifacts/promote`, expect.objectContaining({ method: "POST", headers: { "x-opencrane-artifact-lease": "signed-lease" }, duplex: "half" }));
		const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
		expect(await new Response(request.body).text()).toBe("proof-bound artifact");
	});

	it("fails closed when the private service rejects the promotion or omits a receipt", async function _invalidResponse()
	{
		const port = _CreateArtifactServicePromotionPort(_serviceUrl);
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("denied", { status: 403 })));
		await expect(port.promote("signed-lease", _bytes())).rejects.toThrow("promotion failed with 403");
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({}), { status: 201 })));
		await expect(port.promote("signed-lease", _bytes())).rejects.toThrow("returned no receipt");
	});

	it("uses the fixed read endpoint and dedicated read-lease header", async function _ReadsPinnedArtifact()
	{
		const fetchMock = vi.fn().mockResolvedValue(new Response("artifact", { status: 200 }));
		vi.stubGlobal("fetch", fetchMock);
		const port = _CreateArtifactServiceReadPort(_serviceUrl);

		await expect(port.read("signed-read-lease")).resolves.toBeInstanceOf(Response);
		expect(fetchMock).toHaveBeenCalledWith(`${_serviceUrl}/v1/artifacts/read`, { redirect: "error", headers: { "x-opencrane-artifact-read-lease": "signed-read-lease" } });
	});

	it("reloads published catalogue facts instead of signing caller-supplied byte metadata", async function _ReloadsCatalogueFacts()
	{
		const directory = mkdtempSync(join(tmpdir(), "opencrane-artifact-read-"));
		const keyPath = join(directory, "lease.pem");
		const keys = generateKeyPairSync("ed25519");
		const privateKey = keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
		const publicKey = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
		writeFileSync(keyPath, privateKey, "utf8");
		try
		{
			const findFirst = vi.fn().mockResolvedValue({ id: "revision-1", artifactId: "artifact-1", contentAddress: `sha256:${"b".repeat(64)}`, byteLength: 8n, mediaType: "text/plain; charset=utf-8", artifact: { siloId: "silo-1" } });
			const fetchMock = vi.fn().mockResolvedValue(new Response("artifact", { status: 200, headers: { "content-length": "8", "content-type": "text/plain; charset=utf-8" } }));
			vi.stubGlobal("fetch", fetchMock);
			const reader = _CreateSkillAuthoringArtifactReader({ artifactRevision: { findFirst } } as never, { ARTIFACT_SERVICE_URL: _serviceUrl, ARTIFACT_LEASE_PRIVATE_KEY_PATH: keyPath });
			await expect(reader.read({ siloId: "silo-1", artifactId: "artifact-1", artifactRevisionId: "revision-1", contentAddress: `sha256:${"a".repeat(64)}`, byteLength: 9, mediaType: "application/gzip" })).resolves.toBeInstanceOf(ReadableStream);

			const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
			const compactLease = (request.headers as Record<string, string>)["x-opencrane-artifact-read-lease"] ?? "";
			expect(__VerifyArtifactReadLease(compactLease, publicKey, Math.floor(Date.now() / 1_000))).toMatchObject({ contentAddress: `sha256:${"b".repeat(64)}`, byteLength: 8, mediaType: "text/plain; charset=utf-8" });
			expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "revision-1", artifactId: "artifact-1", state: "Published", artifact: { siloId: "silo-1", state: "Active" } } }));
		}
		finally
		{
			rmSync(directory, { recursive: true, force: true });
		}
	});

	it("refuses artifact bytes whose transport metadata does not match the reloaded revision", async function _RejectsMismatchedMetadata()
	{
		const directory = mkdtempSync(join(tmpdir(), "opencrane-artifact-read-"));
		const keyPath = join(directory, "lease.pem");
		const privateKey = generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" }).toString();
		writeFileSync(keyPath, privateKey, "utf8");
		try
		{
			const artifactRevision = { findFirst: vi.fn().mockResolvedValue({ id: "revision-1", artifactId: "artifact-1", contentAddress: `sha256:${"a".repeat(64)}`, byteLength: 9n, mediaType: "application/gzip", artifact: { siloId: "silo-1" } }) };
			vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("artifact", { status: 200, headers: { "content-length": "8", "content-type": "text/plain" } })));
			const reader = _CreateSkillAuthoringArtifactReader({ artifactRevision } as never, { ARTIFACT_SERVICE_URL: _serviceUrl, ARTIFACT_LEASE_PRIVATE_KEY_PATH: keyPath });
			await expect(reader.read({ siloId: "silo-1", artifactId: "artifact-1", artifactRevisionId: "revision-1", contentAddress: `sha256:${"a".repeat(64)}`, byteLength: 9, mediaType: "application/gzip" })).rejects.toThrow("metadata did not match");
		}
		finally
		{
			rmSync(directory, { recursive: true, force: true });
		}
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
});
