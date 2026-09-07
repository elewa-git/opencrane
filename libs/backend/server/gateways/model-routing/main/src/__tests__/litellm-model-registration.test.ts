import { ModelRoutingScope } from "@opencrane/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { _RegisterLiteLlmModel } from "../core/litellm-model-registration";

/** Environment keys restored after each live-registration boundary test. */
const _SAVED_ENVIRONMENT: Record<string, string | undefined> = {};

/** Stable registration input used to prove malformed responses cannot escape as model ids. */
const _INPUT = { publicModelName: "openai/test", upstreamModel: "openai/test", scope: ModelRoutingScope.Global };

describe("LiteLLM model registration response", function _Suite()
{
	beforeEach(function _Configure()
	{
		for (const key of ["LITELLM_ENDPOINT", "LITELLM_MASTER_KEY"]) _SAVED_ENVIRONMENT[key] = process.env[key];
		process.env.LITELLM_ENDPOINT = "http://litellm.svc";
		process.env.LITELLM_MASTER_KEY = "sk-master";
	});

	afterEach(function _Restore()
	{
		vi.unstubAllGlobals();
		for (const key of ["LITELLM_ENDPOINT", "LITELLM_MASTER_KEY"])
		{
			if (_SAVED_ENVIRONMENT[key] === undefined)
				delete process.env[key];
			else
				process.env[key] = _SAVED_ENVIRONMENT[key];
		}
	});

	it("accepts only a non-empty string deployment id", async function _ValidatesId()
	{
		vi.stubGlobal("fetch", vi.fn()
			.mockResolvedValueOnce(new Response(JSON.stringify({ data: [] }), { status: 200 }))
			.mockResolvedValueOnce(new Response(JSON.stringify({ model_info: { id: "deployment-1" } }), { status: 200 })));

		await expect(_RegisterLiteLlmModel(_INPUT)).resolves.toBe("deployment-1");
	});

	it("uses a string placeholder for wrong-type or invalid JSON responses", async function _FallsBack()
	{
		const fetchMock = vi.fn()
			.mockResolvedValueOnce(new Response(JSON.stringify({ data: [] }), { status: 200 }))
			.mockResolvedValueOnce(new Response(JSON.stringify({ model_id: 42 }), { status: 200 }))
			.mockResolvedValueOnce(new Response(JSON.stringify({ data: [] }), { status: 200 }))
			.mockResolvedValueOnce(new Response("{", { status: 200 }));
		vi.stubGlobal("fetch", fetchMock);

		await expect(_RegisterLiteLlmModel(_INPUT)).resolves.toBe("placeholder:global-openai-test");
		await expect(_RegisterLiteLlmModel(_INPUT)).resolves.toBe("placeholder:global-openai-test");
	});

	it("reuses one exact deployment and does not POST again", async function _ReusesExact()
	{
		const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [{ model_name: "openai/test", model_info: { id: "command-deployment", mode: "chat" }, litellm_params: { model: "openai/test" } }] }), { status: 200 }));
		vi.stubGlobal("fetch", fetchMock);

		await expect(_RegisterLiteLlmModel({ ..._INPUT, deploymentId: "command-deployment" })).resolves.toBe("command-deployment");
		expect(fetchMock).toHaveBeenCalledOnce();
		expect(fetchMock.mock.calls[0][0]).toBe("http://litellm.svc/v2/model/info");
	});

	it("creates the first deployment from an empty v2 catalogue and reuses it on retry", async function _FirstModel()
	{
		const entry = { model_name: "openai/test", model_info: { id: "command-deployment", mode: "chat" }, litellm_params: { model: "openai/test" } };
		let created = false;
		const fetchMock = vi.fn(async function _Fetch(url: string, request?: RequestInit): Promise<Response>
		{
			if (url === "http://litellm.svc/v2/model/info")
				return new Response(JSON.stringify({ data: created ? [entry] : [] }), { status: 200 });
			if (url === "http://litellm.svc/model/new" && request?.method === "POST")
			{
				expect(JSON.parse(request.body as string).model_info.id).toBe("command-deployment");
				created = true;
				return new Response(JSON.stringify({ model_info: { id: "command-deployment" } }), { status: 200 });
			}
			return new Response(JSON.stringify({ detail: { error: "LLM Model List not loaded in" } }), { status: 500 });
		});
		vi.stubGlobal("fetch", fetchMock);
		const input = { ..._INPUT, deploymentId: "command-deployment", requireLiveRegistration: true };

		await expect(_RegisterLiteLlmModel(input)).resolves.toBe("command-deployment");
		await expect(_RegisterLiteLlmModel(input)).resolves.toBe("command-deployment");
		expect(fetchMock.mock.calls.map(call => call[0])).toEqual([
			"http://litellm.svc/v2/model/info",
			"http://litellm.svc/model/new",
			"http://litellm.svc/v2/model/info",
		]);
	});

	it("does not create a deployment when the v2 catalogue is unavailable", async function _UnavailableCatalogue()
	{
		const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: { error: "Database unavailable" } }), { status: 500 }));
		vi.stubGlobal("fetch", fetchMock);

		await expect(_RegisterLiteLlmModel({ ..._INPUT, requireLiveRegistration: true })).rejects.toThrow("model inventory returned HTTP 500");
		expect(fetchMock).toHaveBeenCalledOnce();
		expect(fetchMock.mock.calls[0][0]).toBe("http://litellm.svc/v2/model/info");
	});

	it("uses the admitted command id as LiteLLM's deterministic deployment id", async function _UsesDeterministicId()
	{
		const fetchMock = vi.fn()
			.mockResolvedValueOnce(new Response(JSON.stringify({ data: [] }), { status: 200 }))
			.mockResolvedValueOnce(new Response(JSON.stringify({ model_id: "command-deployment" }), { status: 200 }));
		vi.stubGlobal("fetch", fetchMock);

		await expect(_RegisterLiteLlmModel({ ..._INPUT, deploymentId: "command-deployment" })).resolves.toBe("command-deployment");
		const request = fetchMock.mock.calls[1][1] as RequestInit;
		expect(JSON.parse(request.body as string).model_info).toEqual({ id: "command-deployment" });
	});

	it("refuses a same-name deployment whose admitted configuration differs", async function _Mismatch()
	{
		const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [{ model_name: "openai/test", model_info: { id: "command-deployment" }, litellm_params: { model: "openai/other" } }] }), { status: 200 }));
		vi.stubGlobal("fetch", fetchMock);

		await expect(_RegisterLiteLlmModel({ ..._INPUT, deploymentId: "command-deployment", requireLiveRegistration: true })).rejects.toThrow("does not match");
		expect(fetchMock).toHaveBeenCalledOnce();
	});

	it("refuses ambiguous same-name deployments", async function _Ambiguous()
	{
		const entry = { model_name: "openai/test", model_info: { id: "one" }, litellm_params: { model: "openai/test" } };
		const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [entry, { ...entry, model_info: { id: "two" } }] }), { status: 200 }));
		vi.stubGlobal("fetch", fetchMock);

		await expect(_RegisterLiteLlmModel({ ..._INPUT, requireLiveRegistration: true })).rejects.toThrow("multiple deployments");
		expect(fetchMock).toHaveBeenCalledOnce();
	});

	it("refuses inventory without the required data array", async function _MissingData()
	{
		const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));
		vi.stubGlobal("fetch", fetchMock);

		await expect(_RegisterLiteLlmModel({ ..._INPUT, requireLiveRegistration: true })).rejects.toThrow("data must be an array");
		expect(fetchMock).toHaveBeenCalledOnce();
	});
});
