import { randomUUID } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";

import type { Logger } from "pino";
import { pinoHttp, type HttpLogger } from "pino-http";

import { ___GetContext } from "@opencrane/backend/observability";

/**
 * Removes SSE replay cursors and strips the query and fragment from string referrer headers.
 * @param headers - Headers from pino's standard request serializer.
 * @returns A copy without replay cursor values or string referrer query and fragment values.
 */
function _sanitizeHttpRequestHeaders(headers: IncomingHttpHeaders): IncomingHttpHeaders
{
	const safeHeaders: IncomingHttpHeaders = {};
	for (const [name, value] of Object.entries(headers))
	{
		const lowerName = name.toLowerCase();
		if (lowerName === "last-event-id") continue;
		if ((lowerName === "referer" || lowerName === "referrer") && typeof value === "string")
		{
			safeHeaders[name] = value.replace(/[?#].*$/u, "");
			continue;
		}
		safeHeaders[name] = value;
	}
	return safeHeaders;
}

/**
 * Strips the query and fragment from redirect locations before pino writes response headers.
 * @param headers - Headers from pino's standard response serializer.
 * @returns A copy whose redirect location contains no query or fragment.
 */
function _withoutRedirectQueries(headers: Record<string, unknown>): Record<string, unknown>
{
	const safeHeaders = { ...headers };
	for (const [name, value] of Object.entries(safeHeaders))
	{
		if (name.toLowerCase() === "location" && typeof value === "string") safeHeaders[name] = value.replace(/[?#].*$/u, "");
	}
	return safeHeaders;
}

/**
 * Copies a request log record while removing request queries and replay values.
 *
 * The standard pino-http serializer runs first. This pass also strips referrer queries because a
 * browser can send a signed invitation URL as the referrer when it starts login.
 * @param request - Standard or extended serialized request value.
 * @returns A request record without replay cursors, request URL queries, or referrer queries.
 */
export function _SerializeHttpRequest(request: Record<string, unknown>): Record<string, unknown>
{
	// 1. Copy and sanitize transport URLs so auto-logging cannot retain any query value.
	const serialized = { ...request };
	for (const key of ["url", "originalUrl"])
	{
		const value = serialized[key];
		if (typeof value === "string") serialized[key] = value.replace(/[?#].*$/u, "");
	}

	// 2. Remove replay cursors and browser-referrer queries regardless of their serialized casing.
	if (serialized["headers"] && typeof serialized["headers"] === "object")
	{
		serialized["headers"] = _sanitizeHttpRequestHeaders(serialized["headers"] as IncomingHttpHeaders);
	}

	// 3. Drop serializer-specific cursor containers that bypass URL and header sanitization.
	delete serialized["cursor"];
	delete serialized["query"];
	return serialized;
}

/**
 * Copies response fields while removing query and fragment values from redirect locations.
 *
 * OIDC redirects carry short-lived state and PKCE values, so logging their full `Location` header
 * would retain request-specific security values even though the browser needs the redirect.
 * @param response - Standard or extended serialized response value.
 * @returns A response record whose redirect target contains no query or fragment.
 */
export function _SerializeHttpResponse(response: Record<string, unknown>): Record<string, unknown>
{
	const serialized = { ...response };
	if (serialized["headers"] && typeof serialized["headers"] === "object")
	{
		serialized["headers"] = _withoutRedirectQueries(serialized["headers"] as Record<string, unknown>);
	}
	return serialized;
}

/**
 * Creates the shared request logger with query sanitization for both requests and responses.
 *
 * Called by: `_CreatePublicApp` and `_CreateInternalApp` when they compose the two HTTP listeners.
 * @param logger - Process root logger that receives correlation-aware request records.
 * @returns Express-compatible pino middleware with query-free request and redirect serialization.
 */
export function _CreateHttpRequestLogger(logger: Logger): HttpLogger
{
	return pinoHttp({
		logger,
		genReqId: function _genRequestId() { return ___GetContext()?.requestId ?? randomUUID(); },
		serializers: { req: _SerializeHttpRequest, res: _SerializeHttpResponse },
	});
}
