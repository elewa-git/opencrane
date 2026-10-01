import { ___DigestCanonicalJson } from "@opencrane/util";
import { ___ParseMcpDiscoveryResponse, ___ParseMcpToolCallResponse, ___ParseMcpToolsListResponse, McpResponseDecoder, type McpToolCallResult } from "@opencrane/contracts";

import { McpRemoteProtocolError } from "./mcp-remote-client.errors";
import type { McpRemoteDiscoveryResult, McpRemoteProtocolFailureCodes, McpRemoteToolsListResult } from "./mcp-remote-client.types";

/** Decode one matched response without retaining malformed peer-controlled data. */
function _Payload(body: Uint8Array, contentType: string | undefined, requestId: string, code: McpRemoteProtocolFailureCodes): unknown
{
	try
	{
		const decoder = new McpResponseDecoder(contentType, requestId, body.byteLength);
		return decoder.push(body) ?? decoder.finish();
	}
	catch { throw new McpRemoteProtocolError(code); }
}

/** Keep validated discovery evidence even when the server announces another revision. */
export function _McpRemoteDiscoveryResult(body: Uint8Array, contentType: string | undefined, requestId: string, requestedProtocolVersion: string): McpRemoteDiscoveryResult
{
	try
	{
		const result = ___ParseMcpDiscoveryResponse(_Payload(body, contentType, requestId, "malformed_discovery"), requestId);
		const protocolVersion = result.supportedVersions.includes(requestedProtocolVersion) ? requestedProtocolVersion : result.supportedVersions[0] as string;
		return { protocolVersion, evidenceDigest: ___DigestCanonicalJson(result), cacheScope: result.cacheScope };
	}
	catch (error)
	{
		if (error instanceof McpRemoteProtocolError)
			throw error;
		throw new McpRemoteProtocolError("malformed_discovery");
	}
}

/** Validate and project one tools page. */
export function _McpRemoteToolsListResult(body: Uint8Array, contentType: string | undefined, requestId: string): McpRemoteToolsListResult
{
	try
	{
		const payload = _Payload(body, contentType, requestId, "malformed_tools_list");
		const result = ___ParseMcpToolsListResponse(payload);
		return { ...result, cacheScope: _CacheScope(payload) };
	}
	catch (error)
	{
		if (error instanceof McpRemoteProtocolError)
			throw error;
		throw new McpRemoteProtocolError("malformed_tools_list");
	}
}

/** Read the cache scope from an envelope already accepted by the shared protocol parser. */
function _CacheScope(payload: unknown): "private" | "public"
{
	if (typeof payload !== "object" || payload === null || !("result" in payload) || typeof payload.result !== "object" || payload.result === null || !("cacheScope" in payload.result) || payload.result.cacheScope !== "private" && payload.result.cacheScope !== "public")
		throw new McpRemoteProtocolError("malformed_tools_list");
	return payload.result.cacheScope;
}

/** Validate one completed tool result under its ToolInvocation request id. */
export function _McpRemoteToolCallResult(body: Uint8Array, contentType: string | undefined, invocationId: string): McpToolCallResult
{
	try { return ___ParseMcpToolCallResponse(_Payload(body, contentType, invocationId, "malformed_tool_result"), invocationId); }
	catch (error)
	{
		if (error instanceof McpRemoteProtocolError)
			throw error;
		throw new McpRemoteProtocolError("malformed_tool_result");
	}
}
