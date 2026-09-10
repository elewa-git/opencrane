import { ___BuildMcpDiscoveryRequest, ___BuildMcpRequestHeaders, ___BuildMcpToolCallRequest, ___BuildMcpToolsListRequest, ___ParseMcpDiscoveredTools, ___ParseMcpDiscoveryResponse, ___ParseMcpToolCallResponse, ___ParseMcpToolsListResponse, MCP_PROTOCOL_VERSION, McpResponseDecoder, type McpRequest, type McpDiscoveredTool } from "@opencrane/contracts";
import type { JsonValue } from "@opencrane/util";
import { ___DoWithTrace } from "@opencrane/backend/observability";

import { _BoundedJsonBody, _FetchJson } from "./bounded-json";
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
			const request = ___BuildMcpDiscoveryRequest();
			const response = await _Exchange(options, fetcher, request, undefined, readinessSignal);
			_AssertDiscovery(response);
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

/** Complete pinned discovery and all bounded tool-list pages before accepting live tools. */
async function _Discover(options: McpCompanionServerOptions, fetcher: NonNullable<McpCompanionServerOptions["fetch"]>, signal: AbortSignal): Promise<readonly McpDiscoveredTool[]>
{
	return ___DoWithTrace("mcp_companion.server.discover", {}, async function _DiscoverServer(): Promise<readonly McpDiscoveredTool[]>
	{
		const discoveryDeadline = AbortSignal.any([signal, AbortSignal.timeout(options.requestTimeoutMilliseconds)]);
		const discoveryRequest = ___BuildMcpDiscoveryRequest();
		const discovery = await _Exchange(options, fetcher, discoveryRequest, undefined, discoveryDeadline);
		_AssertDiscovery(discovery);
		const tools: McpDiscoveredTool[] = [];
		const names = new Set<string>();
		const cursors = new Set<string>();
		let cursor: string | undefined;
		for (let page = 0; page < 256; page += 1)
		{
			const request = ___BuildMcpToolsListRequest(cursor);
			const response = await _Exchange(options, fetcher, request, undefined, discoveryDeadline);
			const parsed = ___ParseMcpToolsListResponse(response);
			const pageTools = ___ParseMcpDiscoveredTools(parsed.tools);
			for (const tool of pageTools)
			{
				if (names.has(tool.name))
					throw new Error("MCP server returned a duplicate tool name");
				names.add(tool.name);
				tools.push(tool);
				if (tools.length > 256)
					throw new Error("MCP server returned too many tools");
			}
			if (parsed.nextCursor === null)
				return tools;
			if (cursors.has(parsed.nextCursor))
				throw new Error("MCP server returned a cursor loop");
			cursors.add(parsed.nextCursor);
			cursor = parsed.nextCursor;
		}
		throw new Error("MCP server returned too many tool-list pages");
	});
}

/** Execute one tool call against the frozen schema without rediscovering mutable server state. */
async function _Call(options: McpCompanionServerOptions, fetcher: NonNullable<McpCompanionServerOptions["fetch"]>, command: McpCompanionToolCallCommand, signal: AbortSignal): Promise<import("@opencrane/contracts").McpToolCallResult>
{
	return ___DoWithTrace("mcp_companion.server.tool_call", {}, async function _CallTool(): Promise<import("@opencrane/contracts").McpToolCallResult>
	{
		_AssertFrozenTool(command.toolName, command.inputSchema);
		const request = ___BuildMcpToolCallRequest(command.invocationId, command.toolName, command.arguments);
		const response = await _Exchange(options, fetcher, request, command.inputSchema, signal, command.lease.expiresAt);
		return ___ParseMcpToolCallResponse(response, command.invocationId);
	});
}

/** Check that the frozen command schema is a valid schema for its selected tool. */
function _AssertFrozenTool(toolName: string, inputSchema: JsonValue): void
{
	const tools = ___ParseMcpDiscoveredTools([{ name: toolName, description: null, inputSchema }]);
	if (tools.length !== 1 || tools[0]?.name !== toolName)
		throw new Error("MCP invocation schema did not match its tool name");
}

/** Require the pinned protocol version before accepting any tool data. */
function _AssertDiscovery(payload: unknown): void
{
	const result = ___ParseMcpDiscoveryResponse(payload);
	if (!result.supportedVersions.includes(MCP_PROTOCOL_VERSION))
		throw new Error(`MCP server does not support protocol ${MCP_PROTOCOL_VERSION}`);
}

/** Bind invocation work to the server-issued lease deadline and process shutdown. */
function _LeaseSignal(expiresAt: string, signal: AbortSignal): AbortSignal
{
	const remainingMilliseconds = Date.parse(expiresAt) - Date.now();
	if (!Number.isFinite(remainingMilliseconds) || remainingMilliseconds <= 0)
		throw new Error("MCP companion invocation lease expired before execution");
	const boundedMilliseconds = Math.min(remainingMilliseconds, 2_147_483_647);
	return AbortSignal.any([signal, AbortSignal.timeout(boundedMilliseconds)]);
}

/** Send one bounded request and decode either JSON or request-scoped SSE. */
async function _Exchange(options: McpCompanionServerOptions, fetcher: NonNullable<McpCompanionServerOptions["fetch"]>, request: McpRequest, inputSchema: JsonValue | undefined, signal: AbortSignal, invocationExpiresAt?: string): Promise<unknown>
{
	const body = _BoundedJsonBody(request, options.maximumRequestBytes);
	const headers = { ...___BuildMcpRequestHeaders(request, inputSchema), "content-length": String(Buffer.byteLength(body, "utf8")) };
	// Request preparation can outlast a lease before its abort timer gets an event-loop turn.
	const dispatchSignal = invocationExpiresAt === undefined ? signal : _LeaseSignal(invocationExpiresAt, signal);
	dispatchSignal.throwIfAborted();
	const response = await _FetchJson(fetcher, options.serverUrl, { method: "POST", headers, body, redirect: "error" }, options.requestTimeoutMilliseconds, dispatchSignal);
	return _DecodeResponse(response, String(request.id), options.maximumResponseBytes);
}

/** Decode one bounded response and release its body on success, malformed input, or HTTP failure. */
async function _DecodeResponse(response: Response, expectedId: string, maximumBytes: number): Promise<unknown>
{
	const reader = response.body?.getReader();
	try
	{
		if (!response.ok)
			throw new Error(`MCP server request failed with HTTP ${response.status}`);
		const declaredLength = response.headers.get("content-length");
		if (declaredLength !== null && (!/^\d+$/u.test(declaredLength) || Number(declaredLength) > maximumBytes))
			throw new Error("MCP response exceeded its byte limit");
		if (reader === undefined)
			throw new Error("MCP response body was missing");
		const decoder = new McpResponseDecoder(response.headers.get("content-type") ?? undefined, expectedId, maximumBytes);
		while (true)
		{
			const next = await reader.read();
			if (next.done)
				return decoder.finish();
			const value = decoder.push(next.value);
			if (value !== undefined)
				return value;
		}
	}
	finally
	{
		if (reader !== undefined)
		{
			await reader.cancel().catch(function _IgnoreCancelFailure(): void { return; });
			reader.releaseLock();
		}
	}
}
