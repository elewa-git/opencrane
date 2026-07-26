import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { _CreateArtifactServicePromotionPort, _CreateArtifactServiceReadPort, _CreateArtifactUploadGateway, _CreateSkillAuthoringArtifactReader } from "../artifact-upload.factory.js";

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

	it("uses a signed server lease only for the exact canonical read path", async function _readsPinnedArtifact()
	{
		const fetchMock = vi.fn().mockResolvedValue(new Response("artifact", { status: 200 }));
		vi.stubGlobal("fetch", fetchMock);
		const port = _CreateArtifactServiceReadPort(_serviceUrl);
		const address = `sha256:${"a".repeat(64)}`;

		await expect(port.read("signed-read-lease", address)).resolves.toBeInstanceOf(Response);
		expect(fetchMock).toHaveBeenCalledWith(`${_serviceUrl}/v1/artifacts/content/${"a".repeat(64)}`, { redirect: "error", headers: { "x-opencrane-artifact-lease": "signed-read-lease" } });
		await expect(port.read("signed-read-lease", "../../etc/passwd")).rejects.toThrow("canonical content address");
	});

	it("refuses artifact bytes whose transport metadata does not match the fenced revision", async function _rejectsMismatchedMetadata()
	{
		const directory = mkdtempSync(join(tmpdir(), "opencrane-artifact-read-"));
		const keyPath = join(directory, "lease.pem");
		const key = generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" }).toString();
		writeFileSync(keyPath, key, "utf8");
		try
		{
			vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("artifact", { status: 200, headers: { "content-length": "8", "content-type": "text/plain" } })));
			const reader = _CreateSkillAuthoringArtifactReader({ ARTIFACT_SERVICE_URL: _serviceUrl, ARTIFACT_LEASE_PRIVATE_KEY_PATH: keyPath });
			await expect(reader.read({ siloId: "silo-1", artifactId: "artifact-1", artifactRevisionId: "revision-1", contentAddress: `sha256:${"a".repeat(64)}`, byteLength: 9, mediaType: "application/gzip" })).rejects.toThrow("metadata did not match");
		}
		finally
		{
			rmSync(directory, { recursive: true, force: true });
		}
	});
});
