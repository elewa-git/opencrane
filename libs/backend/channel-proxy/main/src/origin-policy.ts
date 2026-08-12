/**
 * Check a browser `Origin` against an exact allowlist and confirm it matches `Host`.
 *
 * Matching is exact on purpose: no wildcards and no "same base domain" inference, because either
 * would let a sibling tenant's origin through. The origin must be plain HTTPS on the default port
 * with no port, userinfo, path, query, or fragment, so an ingress listening on an alternate port
 * cannot be accepted as the same origin.
 *
 * No caller outside this package yet; {@link __RelayEvents} uses it internally.
 * @param origin - The browser's `Origin` header.
 * @param host - The request's `Host` header.
 * @param allowedOrigins - Exactly the origins that are permitted.
 * @returns The lowercased trusted host when origin and host agree and the origin is allowed; null otherwise, which the caller must treat as a denial.
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
 * Whether a public request carries an identity header only an internal caller may set.
 *
 * The proxy rejects the whole request rather than stripping these, because a stripping list can
 * never be complete and a missed header would be read downstream as trusted identity.
 * @param headers - Headers from the public request.
 * @returns True when any forbidden identity header is present, meaning reject the request.
 */
export function __HasForgedIdentityHeaders(headers: Headers): boolean
{
	const forbidden = ["x-forwarded-user", "x-opencrane-user", "x-opencrane-subject", "x-opencrane-tenant", "x-opencrane-workload"];
	return forbidden.some(header => headers.has(header));
}
