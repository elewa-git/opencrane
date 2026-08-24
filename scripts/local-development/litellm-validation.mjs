/**
 * Confirms an authenticated LiteLLM endpoint exposes the `auto` alias expected by seeded revisions.
 * @throws When the endpoint is unreachable, refuses the key, returns invalid JSON, or omits the alias.
 */
export async function validateLiteLLMModelEndpoint(endpoint, masterKey, fetchImplementation = fetch)
{
	let response;

	try
	{
		response = await fetchImplementation(`${endpoint}/model/info`, {
			headers: { authorization: `Bearer ${masterKey}` },
			signal: AbortSignal.timeout(10_000)
		});
	}
	catch
	{
		throw new Error("LiteLLM model validation could not reach the configured endpoint");
	}

	if (!response.ok)
	{
		throw new Error(`LiteLLM model validation failed with HTTP ${response.status}`);
	}

	let body;

	try
	{
		body = await response.json();
	}
	catch
	{
		throw new Error("LiteLLM model validation returned invalid JSON");
	}

	const models = Array.isArray(body?.data) ? body.data : [];
	const hasAutoModel = models.some(function _isAutoModel(model) { return model?.model_name === "auto"; });

	if (!hasAutoModel)
	{
		throw new Error("LiteLLM must expose the required auto model alias");
	}
}

/** Waits up to 30 seconds for Alternative A's newly started LiteLLM endpoint to expose `auto`. */
export async function waitForLiteLLMModelEndpoint(endpoint, masterKey, fetchImplementation = fetch)
{
	let failure;

	for (let attempt = 0; attempt < 120; attempt += 1)
	{
		try
		{
			await validateLiteLLMModelEndpoint(endpoint, masterKey, fetchImplementation);
			return;
		}
		catch (error)
		{
			failure = error;
		}

		await new Promise(function _wait(resolve) { setTimeout(resolve, 250); });
	}

	throw new Error(`Local LiteLLM did not expose the auto model within 30 seconds: ${failure.message}`);
}
