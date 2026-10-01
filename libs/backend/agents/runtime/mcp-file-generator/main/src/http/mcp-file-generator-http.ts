import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import { ___DoWithTrace, type Logger } from "@opencrane/backend/observability";

import { MCP_FILE_GENERATOR_MAX_REQUEST_BYTES } from "../mcp/mcp-file-generator-contract";
import { _HandleMcpFileGeneratorRequest, _McpFileGeneratorInternalError, _McpFileGeneratorParseError } from "../mcp/mcp-file-generator";
import type { McpFileGeneratorProtocolResponse } from "../mcp/mcp-file-generator.types";

/** Builds the loopback HTTP server used as the uncredentialed container in an OCI MCP Job. */
export function __CreateMcpFileGeneratorServer(log: Logger): Server
{
	return createServer(function _Request(request, response)
	{
		void ___DoWithTrace("mcp_file_generator.request", { method: request.method ?? "unknown", path: request.url ?? "unknown" }, async function _Handle(): Promise<void>
		{
			await _HandleRequest(request, response);
		}).catch(function _Unexpected(err): void
		{
			log.error({ err, operation: "mcp_file_generator.request" }, "MCP file generator request failed");
			if (!response.headersSent)
				_Write(response, _McpFileGeneratorInternalError());
			else
				response.destroy();
		});
	});
}

/** Applies the fixed route, media type, and request byte limit before protocol parsing. */
async function _HandleRequest(request: IncomingMessage, response: ServerResponse): Promise<void>
{
	if (request.url !== "/mcp")
	{
		_Write(response, _McpFileGeneratorParseError(404));
		return;
	}
	if (request.method !== "POST")
	{
		response.setHeader("allow", "POST");
		_Write(response, _McpFileGeneratorParseError(405));
		return;
	}
	const contentType = request.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase();
	if (contentType !== "application/json")
	{
		_Write(response, _McpFileGeneratorParseError(415));
		return;
	}
	const declaredLength = request.headers["content-length"];
	if (declaredLength !== undefined && (!/^\d+$/u.test(declaredLength) || Number(declaredLength) > MCP_FILE_GENERATOR_MAX_REQUEST_BYTES))
	{
		response.setHeader("connection", "close");
		_Write(response, _McpFileGeneratorParseError(413));
		return;
	}
	const bytes = await _ReadBody(request);
	if (bytes === null)
	{
		response.setHeader("connection", "close");
		_Write(response, _McpFileGeneratorParseError(413));
		return;
	}
	let body: string;
	try
	{
		body = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
	}
	catch
	{
		_Write(response, _McpFileGeneratorParseError());
		return;
	}
	let value: unknown;
	try
	{
		value = JSON.parse(body);
	}
	catch
	{
		_Write(response, _McpFileGeneratorParseError());
		return;
	}
	_Write(response, _HandleMcpFileGeneratorRequest(value));
}

/** Reads at most one request ceiling without converting partial bytes to text. */
async function _ReadBody(request: IncomingMessage): Promise<Buffer | null>
{
	const chunks: Buffer[] = [];
	let bytes = 0;
	for await (const chunk of request)
	{
		const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
		bytes += buffer.byteLength;
		if (bytes > MCP_FILE_GENERATOR_MAX_REQUEST_BYTES)
			return null;
		chunks.push(buffer);
	}
	return Buffer.concat(chunks, bytes);
}

/** Writes a JSON response with headers that prevent caching or content sniffing. */
function _Write(response: ServerResponse, result: McpFileGeneratorProtocolResponse): void
{
	const body = JSON.stringify(result.body);
	response.writeHead(result.statusCode, { "cache-control": "no-store", "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(body, "utf8"), "x-content-type-options": "nosniff" });
	response.end(body);
}
