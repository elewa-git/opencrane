import type { Attributes } from "@opentelemetry/api";

/**
 * Build HTTP span attributes from a URL with its query string and fragment removed.
 *
 * A query string routinely carries a token or a cursor, and OpenTelemetry's automatic HTTP
 * instrumentation records the full URL by default. These attributes replace that default, so both
 * the legacy (`http.*`) and current (`url.*`) attribute names must be set — an unset one falls
 * back to the default and leaks the query.
 * @param value - Absolute or relative request URL.
 * @param origin - Origin used to resolve a relative URL; must not itself contain a secret.
 * @returns Attributes with no query string, ready to override the instrumentation defaults.
 */
export function _SanitizeHttpTraceUrl(value: string, origin = "http://localhost"): Attributes
{
	// 1. Bound all subsequent parsing to query-free input so even fallback handling cannot leak it.
	const queryFreeValue = value.replace(/[?#].*$/u, "");
	try
	{
		// 2. Resolve the safe transport path while stripping any embedded URL credentials.
		const parsed = new URL(queryFreeValue, origin);
		const queryFreeUrl = `${parsed.origin}${parsed.pathname}`;

		// 3. Set both the legacy `http.*` and current `url.*` attribute names; an unset one keeps the leaky default.
		return {
			"http.target": parsed.pathname,
			"http.url": queryFreeUrl,
			"url.full": queryFreeUrl,
			"url.path": parsed.pathname,
			"url.query": "",
		};
	}
	catch
	{
		// Invalid URLs fail closed because a hook error would preserve auto-instrumentation defaults.
		return { "http.target": "/", "http.url": "[redacted]", "url.full": "[redacted]", "url.path": "/", "url.query": "" };
	}
}
