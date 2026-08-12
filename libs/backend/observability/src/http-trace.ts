import type { Attributes } from "@opentelemetry/api";

/**
 * Build legacy and stable HTTP trace attributes from a URL after removing its query and fragment.
 * @param value - Absolute or relative HTTP request URL.
 * @param origin - Safe origin used to resolve a relative URL.
 * @returns Query-free attributes that override auto-instrumentation defaults.
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

		// 3. Override both legacy and stable semantic conventions with query-free coordinates.
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
