/**
 * Validate one browser Origin against an exact allowlist and bind it to Host.
 *
 * Exact matching intentionally excludes wildcard and base-domain inference. Both values must use
 * the default HTTPS port so an ingress cannot accidentally admit a sibling or alternate listener.
 *
 * @param origin - Browser Origin header.
 * @param host - Request Host header.
 * @param allowedOrigins - Exact configured origins.
 * @returns The trusted host when the request is same-origin, otherwise null.
 */
export function __ValidateOrigin(origin: string | null, host: string | null, allowedOrigins: ReadonlySet<string>): string | null
{
	if (!origin || !host || !allowedOrigins.has(origin))
	{
		return null;
	}

	try
	{
		const parsed = new URL(origin);
		if (parsed.protocol !== "https:" || parsed.port || parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash)
		{
			return null;
		}

		return parsed.host.toLowerCase() === host.toLowerCase() ? parsed.host.toLowerCase() : null;
	}
	catch
	{
		return null;
	}
}

/**
 * Reject public identity assertions instead of attempting to sanitize an open-ended header set.
 * @param headers - Public request headers.
 * @returns True when a forbidden identity assertion is present.
 */
export function __HasForgedIdentityHeaders(headers: Headers): boolean
{
	const forbidden = ["x-forwarded-user", "x-opencrane-user", "x-opencrane-subject", "x-opencrane-tenant", "x-opencrane-workload"];
	return forbidden.some(header => headers.has(header));
}
