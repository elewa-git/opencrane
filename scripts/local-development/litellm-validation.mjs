/**
 * Confirms an authenticated LiteLLM endpoint exposes the `auto` alias expected by seeded revisions.
 * A session shutdown interrupts the request instead of making the coordinator wait for its timeout.
 *
 * @throws Rejects when the session stops, the endpoint is unreachable, refuses the key, returns invalid JSON, or omits the alias.
 * @see https://docs.litellm.ai/docs/proxy/model_management for LiteLLM's `GET /model/info` response.
 */
export async function validateLiteLLMModelEndpoint(endpoint, masterKey, fetchImplementation = fetch, signal)
{
	let response;

	try
	{
		response = await fetchImplementation(`${endpoint}/model/info`, {
			headers: { authorization: `Bearer ${masterKey}` },
			signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000)
		});
	}
	catch (error)
	{
		if (signal?.aborted)
		{
			throw signal.reason;
		}

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

/**
 * Waits up to 30 seconds for Alternative A's newly started LiteLLM endpoint to expose `auto`.
 * A shutdown stops retries immediately so container cleanup can begin.
 */
export async function waitForLiteLLMModelEndpoint(endpoint, masterKey, fetchImplementation = fetch, signal)
{
	let failure;

	for (let attempt = 0; attempt < 120; attempt += 1)
	{
		try
		{
			await validateLiteLLMModelEndpoint(endpoint, masterKey, fetchImplementation, signal);
			return;
		}
		catch (error)
		{
			if (signal?.aborted)
			{
				throw signal.reason;
			}

			failure = error;
		}

		await new Promise(function _wait(resolve) { setTimeout(resolve, 250); });
	}

	throw new Error(`Local LiteLLM did not expose the auto model within 30 seconds: ${failure.message}`);
}
