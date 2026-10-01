import { ___CreateCsvFile, CsvFileCreationFailureCodes, GENERATED_CSV_INPUT_SCHEMA, GENERATED_CSV_MEDIA_TYPE, GENERATED_CSV_TOOL_NAME } from "@opencrane/models/conversation-assets";
import { MCP_PROTOCOL_VERSION, ___ParseMcpToolCallResult, type McpToolCallResult } from "@opencrane/contracts";
import type { JsonValue } from "@opencrane/util";

import { MCP_FILE_GENERATOR_RESOURCE_URI } from "./mcp-file-generator-contract";
import { McpFileGeneratorErrorCodes, type McpFileGeneratorProtocolResponse } from "./mcp-file-generator.types";

/** Cache lifetime for immutable discovery metadata in milliseconds. */
const _DISCOVERY_CACHE_MILLISECONDS = 3_600_000;

/** Handles the MCP methods used by the repository's OCI companion. */
export function _HandleMcpFileGeneratorRequest(value: unknown): McpFileGeneratorProtocolResponse
{
	if (!_Record(value) || !_ExactKeys(value, ["jsonrpc", "id", "method", "params"]) || value["jsonrpc"] !== "2.0" || !_Coordinate(value["id"]) || typeof value["method"] !== "string" || !_Record(value["params"]))
		return _Error(null, -32600, McpFileGeneratorErrorCodes.InvalidRequest);
	const id = value["id"];
	const method = value["method"];
	const params = value["params"];
	if (!_ProtocolMetadata(params["_meta"]))
		return _Error(id, -32600, McpFileGeneratorErrorCodes.InvalidRequest);
	if (method === "server/discover")
		return _Discover(id, params);
	if (method === "tools/list")
		return _ListTools(id, params);
	if (method === "tools/call")
		return _CallTool(id, params);
	return _Error(id, -32601, McpFileGeneratorErrorCodes.MethodNotFound);
}

/** Returns the single MCP version and capability implemented by this image. */
function _Discover(id: string, params: Record<string, unknown>): McpFileGeneratorProtocolResponse
{
	if (!_ExactKeys(params, ["_meta"]))
		return _Error(id, -32602, McpFileGeneratorErrorCodes.InvalidRequest);
	const result: JsonValue = { resultType: "complete", supportedVersions: [MCP_PROTOCOL_VERSION], capabilities: { tools: {} }, ttlMs: _DISCOVERY_CACHE_MILLISECONDS, cacheScope: "public" };
	return _Success(id, result);
}

/** Returns the immutable schema for the server's sole tool. */
function _ListTools(id: string, params: Record<string, unknown>): McpFileGeneratorProtocolResponse
{
	if (!_ExactKeys(params, ["_meta"]))
		return _Error(id, -32602, McpFileGeneratorErrorCodes.InvalidRequest);
	const tool = { name: GENERATED_CSV_TOOL_NAME, description: "Create a UTF-8 CSV file from bounded tabular values.", inputSchema: GENERATED_CSV_INPUT_SCHEMA };
	const result: JsonValue = { resultType: "complete", tools: [tool], ttlMs: _DISCOVERY_CACHE_MILLISECONDS, cacheScope: "public" };
	return _Success(id, result);
}

/** Validates admitted arguments again and returns one embedded CSV resource. */
function _CallTool(id: string, params: Record<string, unknown>): McpFileGeneratorProtocolResponse
{
	if (!_ExactKeys(params, ["_meta", "name", "arguments"]) || params["name"] !== GENERATED_CSV_TOOL_NAME)
		return _Error(id, -32602, McpFileGeneratorErrorCodes.InvalidArguments);
	const generated = ___CreateCsvFile(params["arguments"]);
	if (!generated.accepted)
	{
		const code = generated.failureCode === CsvFileCreationFailureCodes.GeneratedOutputTooLarge
			? McpFileGeneratorErrorCodes.GeneratedOutputTooLarge
			: McpFileGeneratorErrorCodes.InvalidArguments;
		return _Error(id, -32602, code);
	}
	const result: McpToolCallResult = ___ParseMcpToolCallResult({
		isError: false,
		content: [{ type: "resource", resource: { uri: MCP_FILE_GENERATOR_RESOURCE_URI, mimeType: GENERATED_CSV_MEDIA_TYPE, text: generated.file.text } }],
	});
	return _Success(id, { resultType: "complete", ...result } as unknown as JsonValue);
}

/** Wraps a successful result in the JSON-RPC response shape. */
function _Success(id: string, result: JsonValue): McpFileGeneratorProtocolResponse
{
	return { statusCode: 200, body: { jsonrpc: "2.0", id, result } };
}

/** Returns a stable error without including request data or exception text. */
function _Error(id: string | null, code: number, message: McpFileGeneratorErrorCodes, statusCode = 200): McpFileGeneratorProtocolResponse
{
	return { statusCode, body: { jsonrpc: "2.0", id, error: { code, message } } };
}

/** Requires the protocol revision and capability object sent by the shared MCP request builder. */
function _ProtocolMetadata(value: unknown): boolean
{
	if (!_Record(value) || !_ExactKeys(value, ["io.modelcontextprotocol/clientCapabilities", "io.modelcontextprotocol/protocolVersion"]))
		return false;
	return value["io.modelcontextprotocol/protocolVersion"] === MCP_PROTOCOL_VERSION && _Record(value["io.modelcontextprotocol/clientCapabilities"]);
}

/** Accepts a non-array JSON object. */
function _Record(value: unknown): value is Record<string, unknown>
{
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Requires an object to have every named key and no others. */
function _ExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean
{
	const actual = Object.keys(value).sort();
	const sortedExpected = [...expected].sort();
	return actual.length === sortedExpected.length && actual.every(function _Matches(key, index) { return key === sortedExpected[index]; });
}

/** Accepts the request IDs generated by the current companion. */
function _Coordinate(value: unknown): value is string
{
	return typeof value === "string" && value.length > 0 && value.length <= 256 && !/[\u0000-\u001f\u007f]/u.test(value);
}

/** Creates a parse-error response for the HTTP adapter without exporting protocol internals. */
export function _McpFileGeneratorParseError(statusCode = 400): McpFileGeneratorProtocolResponse
{
	return _Error(null, -32700, McpFileGeneratorErrorCodes.ParseError, statusCode);
}

/** Creates an internal-error response without retaining the thrown value. */
export function _McpFileGeneratorInternalError(): McpFileGeneratorProtocolResponse
{
	return _Error(null, -32603, McpFileGeneratorErrorCodes.InternalError, 500);
}
