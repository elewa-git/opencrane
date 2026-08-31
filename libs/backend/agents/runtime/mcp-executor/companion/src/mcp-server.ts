import { __BuildMcpExecutorDiscoveryRequest, __BuildMcpExecutorToolCallRequest, __BuildMcpExecutorToolsListRequest, __ParseMcpExecutorDiscoveryResponse, __ParseMcpExecutorToolCallResponse, __ParseMcpExecutorToolsListResponse } from "@opencrane/backend/agents/runtime/mcp-executor/protocol";
import { ___DoWithTrace } from "@opencrane/backend/observability";

import { _BoundedJsonBody, _FetchJson, _ReadBoundedJson } from "./bounded-json";
import type { McpCompanionServer, McpCompanionServerOptions, McpCompanionToolCallCommand } from "./mcp-companion.types";

/** Create the bounded Pod-local adapter for the uploaded MCP server. */
export function __CreateMcpCompanionServer(options: McpCompanionServerOptions): McpCompanionServer
{
	_AssertOptions(options);
	const fetcher = options.fetch ?? fetch;
	return {
		ready(signal) { return _Ready(options, fetcher, signal); },
		discover(signal) { return _Discover(options, fetcher, signal); },
		call(command, signal) { return _Call(options, fetcher, command, signal); },
	};
}

/** Wait within one bounded startup window until the uploaded server completes pinned discovery. */
async function _Ready(options: McpCompanionServerOptions, fetcher: NonNullable<McpCompanionServerOptions["fetch"]>, signal: AbortSignal): Promise<void>
{
	const readinessSignal = AbortSignal.any([signal, AbortSignal.timeout(options.requestTimeoutMilliseconds)]);
	while (!readinessSignal.aborted)
	{
		try
		{
			const response = await _Exchange(options, fetcher, __BuildMcpExecutorDiscoveryRequest(), readinessSignal);
			__ParseMcpExecutorDiscoveryResponse(response);
			return;
		}
		catch (err)
		{
			if (readinessSignal.aborted)
				throw err;
			await _WaitForReadiness(readinessSignal);
		}
	}
	throw readinessSignal.reason;
}

/** Delay one startup retry without extending the bounded readiness window. */
async function _WaitForReadiness(signal: AbortSignal): Promise<void>
{
	await new Promise<void>(function _Wait(resolve)
	{
		const timer = setTimeout(resolve, 100);
		signal.addEventListener("abort", function _Abort() { clearTimeout(timer); resolve(); }, { once: true });
	});
}

/** Reject any Pod-local destination, deadline, or byte ceiling outside the launcher contract. */
function _AssertOptions(options: McpCompanionServerOptions): void
{
	if (options.serverUrl !== "http://127.0.0.1:3000/mcp" || !Number.isSafeInteger(options.requestTimeoutMilliseconds) || options.requestTimeoutMilliseconds < 1 || options.requestTimeoutMilliseconds > 120_000 || !Number.isSafeInteger(options.maximumRequestBytes) || options.maximumRequestBytes < 1 || options.maximumRequestBytes > 1_048_576 || !Number.isSafeInteger(options.maximumResponseBytes) || options.maximumResponseBytes < 1 || options.maximumResponseBytes > 4_194_304)
		throw new Error("MCP companion server adapter requires the fixed loopback endpoint and bounded transport limits");
}

/** Complete pinned discovery before accepting live tool definitions. */
async function _Discover(options: McpCompanionServerOptions, fetcher: NonNullable<McpCompanionServerOptions["fetch"]>, signal: AbortSignal)
{
	return ___DoWithTrace("mcp_companion.server.discover", {}, async function _DiscoverServer()
	{
		const discovery = await _Exchange(options, fetcher, __BuildMcpExecutorDiscoveryRequest(), signal);
		__ParseMcpExecutorDiscoveryResponse(discovery);
		const tools = await _Exchange(options, fetcher, __BuildMcpExecutorToolsListRequest(), signal);
		return __ParseMcpExecutorToolsListResponse(tools);
	});
}

/** Execute one tool call and require a matching checked MCP result. */
async function _Call(options: McpCompanionServerOptions, fetcher: NonNullable<McpCompanionServerOptions["fetch"]>, command: McpCompanionToolCallCommand, signal: AbortSignal)
{
	return ___DoWithTrace("mcp_companion.server.tool_call", {}, async function _CallTool()
	{
		const leaseSignal = _LeaseSignal(command, signal);
		const discovery = await _Exchange(options, fetcher, __BuildMcpExecutorDiscoveryRequest(), leaseSignal);
		__ParseMcpExecutorDiscoveryResponse(discovery);
		_AssertCurrentLease(command);
		const request = __BuildMcpExecutorToolCallRequest(command.invocationId, command.toolName, command.arguments);
		const response = await _Exchange(options, fetcher, request, leaseSignal);
		return __ParseMcpExecutorToolCallResponse(response, command.invocationId);
	});
}

/** Bind invocation work to the server-issued lease deadline and process shutdown. */
function _LeaseSignal(command: McpCompanionToolCallCommand, signal: AbortSignal): AbortSignal
{
	const remainingMilliseconds = Date.parse(command.lease.expiresAt) - Date.now();
	if (!Number.isFinite(remainingMilliseconds) || remainingMilliseconds <= 0)
		throw new Error("MCP companion invocation lease expired before execution");
	const boundedMilliseconds = Math.min(remainingMilliseconds, 2_147_483_647);
	return AbortSignal.any([signal, AbortSignal.timeout(boundedMilliseconds)]);
}

/** Refuse to start the actual tool side effect after discovery consumed the lease. */
function _AssertCurrentLease(command: McpCompanionToolCallCommand): void
{
	if (Date.parse(command.lease.expiresAt) <= Date.now())
		throw new Error("MCP companion invocation lease expired before tool call");
}

/** Send one bounded JSON-RPC request to the fixed loopback endpoint. */
async function _Exchange(options: McpCompanionServerOptions, fetcher: NonNullable<McpCompanionServerOptions["fetch"]>, request: unknown, signal: AbortSignal): Promise<unknown>
{
	const body = _BoundedJsonBody(request, options.maximumRequestBytes);
	const headers = { "content-type": "application/json", "content-length": String(Buffer.byteLength(body, "utf8")) };
	const response = await _FetchJson(fetcher, options.serverUrl, { method: "POST", headers, body, redirect: "error" }, options.requestTimeoutMilliseconds, signal);
	if (!response.ok)
		throw new Error(`MCP server request failed with HTTP ${response.status}`);
	return _ReadBoundedJson(response, options.maximumResponseBytes);
}
