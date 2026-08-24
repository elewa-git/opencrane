import { request as _httpsRequest } from "node:https";

import type { McpEraProbeHttpsRequestCommand, McpEraProbeHttpsResponse } from "./mcp-era-probe.types";
import { McpEraProbeConfigurationError, McpEraProbeProtocolError, McpEraProbeTransportError } from "./mcp-era-probe.errors";

/** Normalize Node response headers without exposing array-valued headers. */
function _ResponseHeaders(headers: import("node:http").IncomingHttpHeaders): Record<string, string | undefined>
{
	const normalized: Record<string, string | undefined> = {};
	for (const [name, value] of Object.entries(headers)) normalized[name] = Array.isArray(value) ? value.join(",") : value;
	return normalized;
}

/** Read a finite response body and stop before retaining an oversized reply. */
function _ReadResponse(response: import("node:http").IncomingMessage, maximumResponseBytes: number): Promise<Uint8Array>
{
	return new Promise(function _ReadResponsePromise(resolve, reject)
	{
		const declaredLength = Number(response.headers["content-length"] ?? "0");
		if (!Number.isFinite(declaredLength) || declaredLength < 0 || declaredLength > maximumResponseBytes)
		{
			response.destroy();
			reject(new McpEraProbeTransportError("oversize"));
			return;
		}
		const chunks: Buffer[] = [];
		let byteLength = 0;
		response.on("data", function _Receive(chunk: Buffer)
		{
			byteLength += chunk.byteLength;
			if (byteLength > maximumResponseBytes)
			{
				response.destroy();
				reject(new McpEraProbeTransportError("oversize"));
				return;
			}
			chunks.push(chunk);
		});
		response.once("error", reject);
		response.once("end", function _End() { resolve(Buffer.concat(chunks, byteLength)); });
	});
}

/** Send one HTTPS request while binding the socket to its reviewed DNS address. */
export async function _McpEraProbeHttpsRequest(command: McpEraProbeHttpsRequestCommand): Promise<McpEraProbeHttpsResponse>
{
	return new Promise(function _Send(resolve, reject)
	{
		const request = _httpsRequest(command.endpoint, {
			method: "POST",
			headers: command.headers,
			signal: command.signal,
			lookup: function _UseReviewedAddress(_hostname, _options, callback) { callback(null, command.resolvedAddress.address, command.resolvedAddress.family); },
		}, async function _Receive(response)
		{
			const status = response.statusCode;
			if (status === undefined)
			{ response.destroy(); reject(new McpEraProbeTransportError("network")); return; }
			if (status >= 300 && status < 400)
			{ response.destroy(); reject(new McpEraProbeTransportError("redirect")); return; }
			if (status < 200 || status >= 300)
			{ response.destroy(); reject(new McpEraProbeTransportError(`http_${status}`)); return; }
			try { resolve({ status, headers: _ResponseHeaders(response.headers), body: await _ReadResponse(response, command.maximumResponseBytes) }); }
			catch (error) { reject(error); }
		});
		request.setTimeout(command.timeoutMilliseconds, function _Timeout() { request.destroy(new McpEraProbeTransportError("timeout")); });
		request.once("error", function _Fail(error) { reject(error instanceof McpEraProbeTransportError ? error : new McpEraProbeTransportError("network")); });
		request.end(command.body);
	});
}

/** Normalize resolver, socket, and deadline failures to the bounded adapter vocabulary. */
export function _McpEraProbeTransportFailure(error: unknown): never
{
	if (error instanceof McpEraProbeConfigurationError || error instanceof McpEraProbeTransportError || error instanceof McpEraProbeProtocolError)
		throw error;
	if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError"))
		throw new McpEraProbeTransportError("timeout");
	throw new McpEraProbeTransportError("network");
}

/** Apply one wall-clock deadline to DNS, connection, and response reading. */
export async function _McpEraProbeWithDeadline<Result>(milliseconds: number, operation: (signal: AbortSignal) => Promise<Result>): Promise<Result>
{
	const controller = new AbortController();
	let timeout: ReturnType<typeof setTimeout> | undefined;
	const expired = new Promise<never>(function _Expire(_resolve, reject)
	{
		timeout = setTimeout(function _Abort() { controller.abort(); reject(new McpEraProbeTransportError("timeout")); }, milliseconds);
		timeout.unref();
	});
	try { return await Promise.race([operation(controller.signal), expired]); }
	finally { if (timeout !== undefined)
		clearTimeout(timeout); }
}
