import type { IncomingMessage } from "node:http";

import { McpResponseDecoder } from "@opencrane/contracts";

import { McpEraProbeProtocolError, McpEraProbeTransportError } from "./mcp-era-probe.errors";
import { _MCP_ERA_PROBE_REQUEST_ID } from "./mcp-era-probe-protocol";

/**
 * Read bounded discovery bytes and close an SSE connection as soon as its response arrives.
 *
 * Progress notifications do not finish a probe. The shared decoder matches the request ID before
 * this reader closes the socket, so an idle stream cannot hold the probe open after its result.
 * @throws McpEraProbeProtocolError When framing or the JSON-RPC envelope is invalid.
 * @throws McpEraProbeTransportError When the response exceeds the configured byte limit.
 */
export function _ReadMcpEraProbeResponse(response: IncomingMessage, maximumResponseBytes: number): Promise<Uint8Array>
{
	return new Promise(function _readResponse(resolve, reject)
	{
		const chunks: Buffer[] = [];
		let byteLength = 0;
		let settled = false;
		let decoder: McpResponseDecoder;

		/** Settle once before destroying the socket; destruction may emit another event. */
		function _fail(error: unknown): void
		{
			if (settled)
				return;
			settled = true;
			reject(error);
			response.destroy();
		}

		/** Preserve only bytes acquired before the matching result, then release the connection. */
		function _complete(): void
		{
			if (settled)
				return;
			settled = true;
			resolve(Buffer.concat(chunks, byteLength));
			response.destroy();
		}

		const declaredLength = Number(response.headers["content-length"] ?? "0");
		if (!Number.isFinite(declaredLength) || declaredLength < 0 || declaredLength > maximumResponseBytes)
		{
			_fail(new McpEraProbeTransportError("oversize"));
			return;
		}
		try { decoder = new McpResponseDecoder(response.headers["content-type"], _MCP_ERA_PROBE_REQUEST_ID, maximumResponseBytes); }
		catch { _fail(new McpEraProbeProtocolError("malformed_discovery")); return; }

		response.on("data", function _receive(chunk: Buffer)
		{
			if (settled)
				return;
			byteLength += chunk.byteLength;
			if (byteLength > maximumResponseBytes)
			{
				_fail(new McpEraProbeTransportError("oversize"));
				return;
			}
			chunks.push(chunk);
			try
			{
				if (decoder.push(chunk) !== undefined)
					_complete();
			}
			catch { _fail(new McpEraProbeProtocolError("malformed_discovery")); }
		});
		response.once("error", _fail);
		response.once("end", function _end()
		{
			if (settled)
				return;
			try { decoder.finish(); _complete(); }
			catch { _fail(new McpEraProbeProtocolError("malformed_discovery")); }
		});
		response.once("close", function _closed()
		{
			if (!settled)
				_fail(new McpEraProbeTransportError("network"));
		});
	});
}
