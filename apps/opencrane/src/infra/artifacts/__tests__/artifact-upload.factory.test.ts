import { afterEach, describe, expect, it, vi } from "vitest";

import { _CreateArtifactServicePromotionPort, _CreateArtifactUploadGateway } from "../artifact-upload.factory.js";

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
});
