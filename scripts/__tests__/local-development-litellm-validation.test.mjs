import assert from "node:assert/strict";
import test from "node:test";
import { validateLiteLLMModelEndpoint, waitForLiteLLMModelEndpoint } from "../local-development/litellm-validation.mjs";

test("LiteLLM validation requires the auto model alias and keeps its key in a header", async function _validModelInventory()
{
	let request;
	const fetchImplementation = async function _Fetch(url, init)
	{
		request = { url, init };
		return new Response(JSON.stringify({ data: [{ model_name: "auto" }] }), {
			status: 200,
			headers: { "content-type": "application/json" }
		});
	};

	await validateLiteLLMModelEndpoint("https://litellm.example.test", "admin-secret", fetchImplementation);
	assert.equal(request.url, "https://litellm.example.test/model/info");
	assert.equal(request.init.headers.authorization, "Bearer admin-secret");
});

test("LiteLLM validation fails closed for credentials and missing aliases", async function _invalidModelInventory()
{
	await assert.rejects(validateLiteLLMModelEndpoint("https://litellm.example.test", "bad-key", async function _Unauthorized()
	{
		return new Response("unauthorized", { status: 401 });
	}), /HTTP 401/);
	await assert.rejects(validateLiteLLMModelEndpoint("https://litellm.example.test", "admin-key", async function _MissingAlias()
	{
		return new Response(JSON.stringify({ data: [{ model_name: "other" }] }), {
			status: 200,
			headers: { "content-type": "application/json" }
		});
	}), /auto model alias/);
});

test("local LiteLLM validation waits through startup before accepting its model inventory", async function _waitForStartup()
{
	let calls = 0;
	await waitForLiteLLMModelEndpoint("http://127.0.0.1:4000", "master-key", async function _Starting()
	{
		calls += 1;

		if (calls === 1)
		{
			throw new Error("not ready");
		}

		return new Response(JSON.stringify({ data: [{ model_name: "auto" }] }), {
			status: 200,
			headers: { "content-type": "application/json" }
		});
	});
	assert.equal(calls, 2);
});
