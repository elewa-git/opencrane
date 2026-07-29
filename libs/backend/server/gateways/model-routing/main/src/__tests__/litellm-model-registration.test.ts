import { ModelRoutingScope } from "@opencrane/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { _RegisterLiteLlmModel } from "../core/litellm-model-registration.js";

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
			if (_SAVED_ENVIRONMENT[key] === undefined) delete process.env[key];
			else process.env[key] = _SAVED_ENVIRONMENT[key];
		}
	});

	it("accepts only a non-empty string deployment id", async function _ValidatesId()
	{
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ model_info: { id: "deployment-1" } }), { status: 200 })));

		await expect(_RegisterLiteLlmModel(_INPUT)).resolves.toBe("deployment-1");
	});

	it("uses a string placeholder for wrong-type or invalid JSON responses", async function _FallsBack()
	{
		const fetchMock = vi.fn()
			.mockResolvedValueOnce(new Response(JSON.stringify({ model_id: 42 }), { status: 200 }))
			.mockResolvedValueOnce(new Response("{", { status: 200 }));
		vi.stubGlobal("fetch", fetchMock);

		await expect(_RegisterLiteLlmModel(_INPUT)).resolves.toBe("placeholder:global-openai-test");
		await expect(_RegisterLiteLlmModel(_INPUT)).resolves.toBe("placeholder:global-openai-test");
	});
});
