import { lookup } from "node:dns/promises";

import { MCP_PROTOCOL_VERSION, McpProtocolError, ___BuildMcpDiscoveryRequest, ___BuildMcpRequestHeaders, ___BuildMcpToolCallRequest, ___BuildMcpToolsListRequest, type McpRequest } from "@opencrane/contracts";
import { ___DoWithoutTrace, ___DoWithTrace, ___MarkActiveSpanFailed } from "@opencrane/backend/observability";
import type { JsonValue } from "@opencrane/util";

import { _McpRemoteEndpoint, _McpRemoteIsPublicAddress } from "./mcp-remote-client-address-policy";
import { McpRemoteConfigurationError, McpRemoteTransportError } from "./mcp-remote-client.errors";
import { _McpRemoteFailure, _McpRemoteHttpsRequest, _McpRemoteWithDeadline } from "./mcp-remote-client-https";
import { _McpRemoteDiscoveryResult, _McpRemoteToolCallResult, _McpRemoteToolsListResult } from "./mcp-remote-client-protocol";
import { McpRemoteAuthorizationKinds, McpRemoteDeliveryStates, type McpRemoteClient, type McpRemoteCommand, type McpRemoteDnsAddress, type McpRemoteDnsResolver, type McpRemoteHttpsClientOptions, type McpRemoteHttpsRequest, type McpRemoteHttpsResponse, type McpRemoteProtocolFailureCodes } from "./mcp-remote-client.types";

/** Stable request identity for one discovery operation. */
const _DISCOVERY_REQUEST_ID = "opencrane-mcp-era-probe";

/** Create the one HTTPS client for catalogue checks, authenticated discovery, and remote calls. */
export function __CreateHttpsMcpRemoteClient(options: McpRemoteHttpsClientOptions): McpRemoteClient
{
	if (!Number.isSafeInteger(options.requestTimeoutMilliseconds) || options.requestTimeoutMilliseconds < 1_000 || options.requestTimeoutMilliseconds > 60_000 || !Number.isSafeInteger(options.maximumResponseBytes) || options.maximumResponseBytes < 1 || options.maximumResponseBytes > 1_048_576)
		throw new McpRemoteConfigurationError("invalid_endpoint");
	const resolve: McpRemoteDnsResolver = options.resolve ?? async function _Resolve(hostname): Promise<readonly McpRemoteDnsAddress[]>
	{
		const records = await lookup(hostname, { all: true, verbatim: true });
		if (records.some(function _UnknownFamily(record) { return record.family !== 4 && record.family !== 6; }))
			throw new McpRemoteConfigurationError("unsafe_address");
		return records.map(function _Record(record): McpRemoteDnsAddress { return { address: record.address, family: record.family as 4 | 6 }; });
	};
	const request: McpRemoteHttpsRequest = options.request ?? _McpRemoteHttpsRequest;

	return {
		async discover(command)
		{
			const prepared = { operation: "server/discover", request: _Prepare(function _DiscoveryRequest() { return ___BuildMcpDiscoveryRequest(_DISCOVERY_REQUEST_ID, MCP_PROTOCOL_VERSION); }), malformedResponseCode: "malformed_discovery" } as const;
			const response = await _Send(options, resolve, request, command, prepared);
			return _McpRemoteDiscoveryResult(response.body, response.headers["content-type"], prepared.request.id, MCP_PROTOCOL_VERSION);
		},
		async listTools(command)
		{
			const prepared = { operation: "tools/list", request: _Prepare(function _ToolsListRequest() { return ___BuildMcpToolsListRequest(command.cursor); }), malformedResponseCode: "malformed_tools_list" } as const;
			const response = await _Send(options, resolve, request, command, prepared);
			return _McpRemoteToolsListResult(response.body, response.headers["content-type"], prepared.request.id);
		},
		async callTool(command)
		{
			const prepared = { operation: "tools/call", request: _Prepare(function _ToolCallRequest() { return ___BuildMcpToolCallRequest(command.invocationId, command.toolName, command.arguments); }), inputSchema: command.inputSchema, malformedResponseCode: "malformed_tool_result" } as const;
			const response = await _Send(options, resolve, request, command, prepared);
			return _McpRemoteToolCallResult(response.body, response.headers["content-type"], command.invocationId);
		},
	};
}

/** Send one prepared operation through the shared endpoint and transport policy. */
async function _Send(options: McpRemoteHttpsClientOptions, resolve: McpRemoteDnsResolver, request: McpRemoteHttpsRequest, command: McpRemoteCommand, prepared: { readonly operation: "server/discover" | "tools/list" | "tools/call"; readonly request: McpRequest; readonly inputSchema?: JsonValue; readonly malformedResponseCode: McpRemoteProtocolFailureCodes }): Promise<McpRemoteHttpsResponse>
{
	const endpoint = _McpRemoteEndpoint(command.endpoint);
	const headers = _Prepare(function _RequestHeaders() { return _Headers(prepared.request, prepared.inputSchema, command); });
	const body = _Prepare(function _RequestBody() { return new TextEncoder().encode(JSON.stringify(prepared.request)); });
	return _McpRemoteWithDeadline(options.requestTimeoutMilliseconds, command.signal, async function _BeforeDeadline(signal, markDispatched): Promise<McpRemoteHttpsResponse>
	{
		return ___DoWithTrace("mcp.remote_request", { method: prepared.operation, protocolVersion: MCP_PROTOCOL_VERSION }, async function _Request(): Promise<McpRemoteHttpsResponse>
		{
			let addresses: readonly McpRemoteDnsAddress[];
			try { addresses = await resolve(endpoint.hostname); }
			catch (error) { return _McpRemoteFailure(error, McpRemoteDeliveryStates.ProvenNotDispatched); }
			if (addresses.length === 0 || addresses.some(function _UnsafeAddress(address) { return !_McpRemoteIsPublicAddress(address); }))
				throw new McpRemoteConfigurationError("unsafe_address");
			if (signal.aborted)
				throw new McpRemoteTransportError("aborted", McpRemoteDeliveryStates.ProvenNotDispatched);
			try
			{
				markDispatched();
				const response = await ___DoWithoutTrace(function _RequestWithoutSensitiveTrace(): Promise<McpRemoteHttpsResponse>
				{
					return request({ endpoint, resolvedAddress: addresses[0] as McpRemoteDnsAddress, body, headers, timeoutMilliseconds: options.requestTimeoutMilliseconds, maximumResponseBytes: options.maximumResponseBytes, signal, requestId: prepared.request.id, malformedResponseCode: prepared.malformedResponseCode });
				});
				if (response.status >= 300 && response.status < 400)
					throw new McpRemoteTransportError("redirect", McpRemoteDeliveryStates.MaybeDispatched);
				if (response.status < 200 || response.status >= 300)
					throw new McpRemoteTransportError(`http_${response.status}`, McpRemoteDeliveryStates.MaybeDispatched);
				if (response.body.byteLength > options.maximumResponseBytes)
					throw new McpRemoteTransportError("oversize", McpRemoteDeliveryStates.MaybeDispatched);
				return response;
			}
			catch (error)
			{
				___MarkActiveSpanFailed();
				return _McpRemoteFailure(error, McpRemoteDeliveryStates.MaybeDispatched);
			}
		});
	});
}

/** Convert shared request-builder refusals into the transport's pre-dispatch vocabulary. */
function _Prepare<Result>(build: () => Result): Result
{
	try { return build(); }
	catch (error)
	{
		if (error instanceof McpRemoteConfigurationError)
			throw error;
		if (error instanceof McpProtocolError)
			throw new McpRemoteConfigurationError("invalid_request");
		throw new McpRemoteConfigurationError("invalid_request");
	}
}

/** Build protocol headers, then add the one supported ephemeral authorization profile. */
function _Headers(request: McpRequest, inputSchema: JsonValue | undefined, command: McpRemoteCommand): Readonly<Record<string, string>>
{
	const headers = { ...___BuildMcpRequestHeaders(request, inputSchema) };
	if (command.authorization === undefined)
		return headers;
	if (command.authorization.kind !== McpRemoteAuthorizationKinds.Bearer || command.authorization.token.length === 0 || command.authorization.token.length > 8_192 || /[\r\n]/u.test(command.authorization.token))
		throw new McpRemoteConfigurationError("invalid_authorization");
	return { ...headers, Authorization: `Bearer ${command.authorization.token}` };
}
