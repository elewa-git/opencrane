import { randomUUID } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";

import type { Logger } from "pino";
import { pinoHttp, type HttpLogger } from "pino-http";

import { ___GetContext } from "@opencrane/backend/observability";

/** Drop the `last-event-id` replay-cursor header, matching its name in any letter case. */
function _withoutReplayCursorHeaders(headers: IncomingHttpHeaders): IncomingHttpHeaders
{
	const safeHeaders: IncomingHttpHeaders = {};
	for (const [name, value] of Object.entries(headers))
	{
		if (name.toLowerCase() !== "last-event-id") safeHeaders[name] = value;
	}
	return safeHeaders;
}

/**
 * Copy only query-free request fields into an HTTP request log record.
 *
 * The standard pino-http serializer runs first. This extra safety pass also handles
 * Express' `originalUrl` and any raw `query` or `cursor` fields supplied by a future serializer.
 * @param request - Standard or extended serialized request value.
 * @returns A request record that cannot retain replay cursors or any URL query string.
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

	// 2. Remove replay-resume headers regardless of their serialized casing.
	if (serialized["headers"] && typeof serialized["headers"] === "object")
	{
		serialized["headers"] = _withoutReplayCursorHeaders(serialized["headers"] as IncomingHttpHeaders);
	}

	// 3. Drop serializer-specific cursor containers so future extensions remain fail-closed.
	delete serialized["cursor"];
	delete serialized["query"];
	return serialized;
}

/**
 * Create the shared request logger used by both OpenCrane HTTP listeners.
 * @param logger - Process root logger that receives correlation-aware request records.
 * @returns Express-compatible pino middleware with query-free request serialization.
 */
export function _CreateHttpRequestLogger(logger: Logger): HttpLogger
{
	return pinoHttp({
		logger,
		genReqId: function _genRequestId() { return ___GetContext()?.requestId ?? randomUUID(); },
		serializers: { req: _SerializeHttpRequest },
	});
}
