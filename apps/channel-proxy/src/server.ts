import { createServer } from "node:http";
import type { IncomingHttpHeaders, IncomingMessage, Server, ServerResponse } from "node:http";

import { __FixedWindowRateLimiter, __OpenCraneTargetResolver, __RelayEvents } from "@opencrane/backend/channel-proxy";
import type { ChannelProxyDependencies } from "@opencrane/backend/channel-proxy";
import { ___DoWithTrace } from "@opencrane/backend/observability";
import type { ChannelProxyProcessConfig } from "./config.types.js";
import { _log as log } from "./log.js";

/** Create the standalone channel trust-boundary HTTP server. */
export function _CreateServer(config: ChannelProxyProcessConfig): Server
{
	const dependencies: ChannelProxyDependencies = {
		config: config.proxy,
		resolver: new __OpenCraneTargetResolver({ baseUrl: config.openCraneUrl, timeoutMs: config.resolverTimeoutMs }),
		rateLimiter: new __FixedWindowRateLimiter(config.rateLimit, config.rateWindowMs),
		fetch,
	};
	return createServer(function _handle(request, response)
	{
		const path = new URL(request.url ?? "/", "http://localhost").pathname;
		void ___DoWithTrace("channel.request", { method: request.method ?? "UNKNOWN", path }, function _runRequest()
		{
			return _HandleRequest(request, response, dependencies);
		}).catch(function _handleUnexpected(err)
		{
			log.error({ err, method: request.method, path }, "unhandled channel request failure");
			response.destroy(err instanceof Error ? err : new Error("channel request failed"));
		});
	});
}

/** Route probes and SSE relay without adding product authority. */
async function _HandleRequest(request: IncomingMessage, response: ServerResponse, dependencies: ChannelProxyDependencies): Promise<void>
{
	const path = new URL(request.url ?? "/", "http://localhost").pathname;
	try
	{
		if (path === "/livez" || path === "/readyz")
		{
			_WriteResponse(response, new Response(null, { status: 204 }));
			return;
		}
		if (path !== "/v1/events")
		{
			_WriteResponse(response, Response.json({ error: "not_found" }, { status: 404 }));
			return;
		}

		// 1. Adapt the event request to the Web Request contract used by the domain library.
		const abort = new AbortController();
		response.on("close", function _onClose()
		{
			if (!response.writableEnded)
			{
				abort.abort(new Error("downstream disconnected"));
			}
		});
		const webRequest = new Request(`https://${request.headers.host ?? "invalid"}${request.url ?? "/"}`, { method: request.method, headers: _ToHeaders(request.headers), signal: abort.signal });

		// 2. Dispatch only the canonical SSE endpoint.
		const webResponse = await __RelayEvents(webRequest, dependencies);

		// 3. Stream the bounded response back while preserving downstream disconnect cancellation.
		await _WriteResponse(response, webResponse);
	}
	catch (error)
	{
		log.error({ err: error, method: request.method, path }, "channel request failed");
		if (!response.headersSent)
		{
			_WriteResponse(response, Response.json({ error: "internal_error" }, { status: 500 }));
		}
		else
		{
			response.destroy(error instanceof Error ? error : new Error("channel proxy response failed"));
		}
	}
}

/** Convert Node's multi-value request headers without inventing trusted identity headers. */
function _ToHeaders(source: IncomingHttpHeaders): Headers
{
	const result = new Headers();
	for (const [name, value] of Object.entries(source))
	{
		if (Array.isArray(value))
		{
			for (const item of value)
			{
				result.append(name, item);
			}
		}
		else if (value !== undefined)
		{
			result.set(name, value);
		}
	}
	return result;
}

/** Write one Web Response to Node's response stream with backpressure. */
async function _WriteResponse(target: ServerResponse, source: Response): Promise<void>
{
	target.writeHead(source.status, Object.fromEntries(source.headers.entries()));
	if (!source.body)
	{
		target.end();
		return;
	}
	const reader = source.body.getReader();
	try
	{
		while (true)
		{
			const result = await reader.read();
			if (result.done)
			{
				target.end();
				return;
			}
			if (!target.write(result.value))
			{
				await new Promise<void>(function _waitForDrain(resolve) { target.once("drain", resolve); });
			}
		}
	}
	finally
	{
		reader.releaseLock();
	}
}
