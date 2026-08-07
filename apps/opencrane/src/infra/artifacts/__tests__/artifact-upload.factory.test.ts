import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { __VerifyArtifactReadLease } from "@opencrane/backend/artifacts/authorization";
import { afterEach, describe, expect, it, vi } from "vitest";

import { _CreateArtifactServicePromotionPort, _CreateArtifactUploadGateway, _CreateSkillAuthoringArtifactReader } from "../artifact-upload.factory.js";
import { _CreateArtifactServiceReadPort } from "../artifact-service-read-port.factory.js";

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
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{", { status: 201 })));
		await expect(port.promote("signed-lease", _bytes())).rejects.toThrow(/artifact service promotion response must contain valid JSON/);
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

});
