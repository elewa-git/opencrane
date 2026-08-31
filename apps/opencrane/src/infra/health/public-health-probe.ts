import type { PublicHealthProbe } from "./public-health.types";

/** Caps each dependency call at 750 ms so one service cannot hold the public report open indefinitely. */
const _SERVICE_PROBE_TIMEOUT_MILLISECONDS = 750;

/** Checks a private HTTP target without returning its response body to the public report. */
class _HttpHealthProbe implements PublicHealthProbe
{
	/** Build one fixed request; headers may contain a credential and must never be logged or traced. */
	public constructor(private readonly _url: URL, private readonly _headers: Readonly<Record<string, string>> = {}) {}

	/** Require one successful response before the in-cluster timeout expires. */
	public async check(): Promise<void>
	{
		const response = await fetch(this._url, { method: "GET", headers: this._headers, redirect: "error", signal: AbortSignal.timeout(_SERVICE_PROBE_TIMEOUT_MILLISECONDS) });
		await response.body?.cancel();
		if (!response.ok) throw new Error("service health check failed");
	}
}

/** Represents missing or unsafe required configuration as an unavailable service check. */
class _UnavailableHealthProbe implements PublicHealthProbe
{
	/** Reject without including the missing configuration value. */
	public async check(): Promise<void>
	{
		throw new Error("required service health check is unavailable");
	}
}

/**
 * Build a bounded GET probe from one credential-free base URL and fixed path.
 *
 * Called by: the public health composition and its transport contract tests.
 *
 * @param baseUrl - Deployment-owned private service origin.
 * @param path - Fixed health path owned by the target service.
 * @param headers - Optional fixed headers; values must never enter logs or traces.
 * @returns A probe that rejects for invalid configuration or an unsuccessful response.
 */
export function _CreateHttpHealthProbe(baseUrl: string | undefined, path: string, headers: Readonly<Record<string, string>> = {}): PublicHealthProbe
{
	if (!baseUrl) return new _UnavailableHealthProbe();
	try
	{
		const base = new URL(baseUrl);
		if ((base.protocol !== "http:" && base.protocol !== "https:") || base.username || base.password) return new _UnavailableHealthProbe();
		return new _HttpHealthProbe(new URL(path, base), headers);
	}
	catch
	{
		return new _UnavailableHealthProbe();
	}
}

/**
 * Build the model-routing probe without exposing the LiteLLM master key to report fields.
 *
 * Called by: the public health composition and its transport contract tests.
 *
 * @param environment - Frozen process environment containing the LiteLLM origin and key.
 * @returns A bounded authenticated model-inventory probe.
 */
export function _CreateModelHealthProbe(environment: NodeJS.ProcessEnv): PublicHealthProbe
{
	const masterKey = environment.LITELLM_MASTER_KEY?.trim();
	if (!masterKey) return new _UnavailableHealthProbe();
	return _CreateHttpHealthProbe(environment.LITELLM_ENDPOINT?.trim(), "/v1/models", { authorization: `Bearer ${masterKey}` });
}
