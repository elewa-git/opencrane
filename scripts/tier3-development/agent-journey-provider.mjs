const _PROVIDER_RETRY_LIMIT = 30;
const _POLL_INTERVAL_MILLISECONDS = 2_000;
const _PROVIDER_TIMEOUT_MILLISECONDS = 60_000;

/**
 * Submits the provider key through the BYOK command and resumes the same command while its effect
 * remains pending. A 200 response is accepted only when it proves both product and LiteLLM setup.
 * @throws When the command cannot resume, exceeds its deadline, or returns incomplete evidence.
 */
export async function configureTier3Provider(request, provider, apiKey, sleep, now)
{
	let commandId;
	const deadline = now() + _PROVIDER_TIMEOUT_MILLISECONDS;
	for (let attempt = 0; attempt < _PROVIDER_RETRY_LIMIT; attempt += 1)
	{
		const remainingMilliseconds = deadline - now();
		if (remainingMilliseconds <= 0)
			break;
		const body = commandId === undefined ? { apiKey } : { apiKey, commandId };
		const result = await request("PUT", `/api/v1/providers/byok/${encodeURIComponent(provider)}`, body, new Set([200, 503]), remainingMilliseconds);
		if (result.status === 200)
		{
			if (result.body?.provider !== provider || result.body?.configured !== true || result.body?.litellmRegistered !== true)
				throw new Error("Tier 3 BYOK response did not prove a usable provider connection.");
			return;
		}
		if (result.body?.code !== "PROVIDER_EFFECT_PENDING" || typeof result.body?.commandId !== "string")
			throw new Error("Tier 3 BYOK delivery returned an unresumable pending response.");
		commandId = result.body.commandId;
		await sleep(Math.min(_POLL_INTERVAL_MILLISECONDS, Math.max(0, deadline - now())));
	}
	throw new Error("Tier 3 BYOK delivery did not settle within one minute.");
}
