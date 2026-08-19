import { afterEach, describe, expect, it, vi } from "vitest";

import { _CreateHttpHealthProbe, _CreateModelHealthProbe } from "../public-health-probe";

describe("public health HTTP probes", function _Suite()
{
	afterEach(function _RestoreFetch()
	{
		vi.unstubAllGlobals();
	});

	it("uses the fixed health path, bounded signal, and supplied private header", async function _UsesFixedRequest()
	{
		const response = new Response("discarded");
		const cancel = vi.spyOn(response.body as ReadableStream, "cancel").mockResolvedValue(undefined);
		const fetch = vi.fn().mockResolvedValue(response);
		vi.stubGlobal("fetch", fetch);
		await _CreateHttpHealthProbe("http://memory.svc.cluster.local:8080/private", "/readyz", { authorization: "Bearer private" }).check();
		expect(fetch).toHaveBeenCalledWith(new URL("http://memory.svc.cluster.local:8080/readyz"), {
			method: "GET",
			headers: { authorization: "Bearer private" },
			redirect: "error",
			signal: expect.any(AbortSignal),
		});
		expect(cancel).toHaveBeenCalledOnce();
	});

	it("rejects non-success responses and unsafe service origins", async function _RejectsUnavailableTargets()
	{
		const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 503 }));
		vi.stubGlobal("fetch", fetch);
		await expect(_CreateHttpHealthProbe("https://models.svc.cluster.local", "/readyz").check()).rejects.toThrow("service health check failed");
		await expect(_CreateHttpHealthProbe("file:///private/service", "/readyz").check()).rejects.toThrow("required service health check is unavailable");
		await expect(_CreateHttpHealthProbe("http://user:secret@memory.svc.cluster.local", "/readyz").check()).rejects.toThrow("required service health check is unavailable");
		expect(fetch).toHaveBeenCalledOnce();
	});

	it("authenticates the fixed LiteLLM model-inventory request", async function _UsesModelInventory()
	{
		const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
		vi.stubGlobal("fetch", fetch);
		await _CreateModelHealthProbe({ LITELLM_ENDPOINT: "http://litellm.svc:4000", LITELLM_MASTER_KEY: "master-key" }).check();
		expect(fetch).toHaveBeenCalledWith(new URL("http://litellm.svc:4000/model/info"), expect.objectContaining({
			headers: { authorization: "Bearer master-key" },
		}));
	});
});
