import { describe, expect, it } from "vitest";

import { MCP_EXECUTOR_PROTOCOL_VERSION, __BuildMcpExecutorDiscoveryRequest, __BuildMcpExecutorToolCallRequest, __ParseMcpExecutorDiscoveryResponse, __ParseMcpExecutorToolCallResponse, __ParseMcpExecutorToolsListResponse } from "../index";

describe("MCP executor protocol", function _DescribeMcpExecutorProtocol()
{
	it("accepts only complete MCP 2026-07-28 discovery", function _DiscoversPinnedVersion()
	{
		expect(__BuildMcpExecutorDiscoveryRequest()).toMatchObject({ method: "server/discover", params: { _meta: { protocolVersion: MCP_EXECUTOR_PROTOCOL_VERSION } } });
		expect(function _PinnedVersion() { __ParseMcpExecutorDiscoveryResponse({ jsonrpc: "2.0", id: "opencrane-mcp-discovery", result: { resultType: "complete", supportedVersions: ["2026-07-28"] } }); }).not.toThrow();
		expect(function _OldVersion() { __ParseMcpExecutorDiscoveryResponse({ jsonrpc: "2.0", id: "opencrane-mcp-discovery", result: { resultType: "complete", supportedVersions: ["2025-06-18"] } }); }).toThrow(/does not support/);
	});

	it("rejects duplicate or malformed live tool definitions", function _ChecksTools()
	{
		const valid = { jsonrpc: "2.0", id: "opencrane-mcp-tools", result: { tools: [{ name: "calendar.read", description: "Reads events", inputSchema: { type: "object" } }] } };
		expect(__ParseMcpExecutorToolsListResponse(valid)).toEqual([{ name: "calendar.read", description: "Reads events", inputSchema: { type: "object" } }]);
		expect(function _Duplicates() { __ParseMcpExecutorToolsListResponse({ jsonrpc: "2.0", id: "opencrane-mcp-tools", result: { tools: [valid.result.tools[0], valid.result.tools[0]] } }); }).toThrow(/invalid/);
		expect(function _InjectedField() { __ParseMcpExecutorToolsListResponse({ jsonrpc: "2.0", id: "opencrane-mcp-tools", result: { tools: [{ ...valid.result.tools[0], registryReference: "controller-selected" }] } }); }).toThrow(/invalid/);
		expect(function _NullSchema() { __ParseMcpExecutorToolsListResponse({ jsonrpc: "2.0", id: "opencrane-mcp-tools", result: { tools: [{ name: "invalid", inputSchema: null }] } }); }).toThrow(/invalid/);
		expect(function _ArraySchema() { __ParseMcpExecutorToolsListResponse({ jsonrpc: "2.0", id: "opencrane-mcp-tools", result: { tools: [{ name: "invalid", inputSchema: [] }] } }); }).toThrow(/invalid/);
	});

	it("matches one saved invocation and keeps tool errors explicit", function _CallsTool()
	{
		expect(__BuildMcpExecutorToolCallRequest("invocation-1", "calendar.read", { day: "today" })).toMatchObject({ id: "invocation-1", method: "tools/call" });
		expect(__ParseMcpExecutorToolCallResponse({ jsonrpc: "2.0", id: "invocation-1", result: { isError: false, content: [{ type: "text", text: "ready" }] } }, "invocation-1")).toEqual({ isError: false, content: [{ type: "text", text: "ready" }] });
		expect(function _MismatchedId() { __ParseMcpExecutorToolCallResponse({ jsonrpc: "2.0", id: "other", result: { isError: false, content: [] } }, "invocation-1"); }).toThrow(/did not match/);
		expect(function _NullContent() { __ParseMcpExecutorToolCallResponse({ jsonrpc: "2.0", id: "invocation-1", result: { isError: false, content: null } }, "invocation-1"); }).toThrow(/invalid/);
		expect(function _MalformedContent() { __ParseMcpExecutorToolCallResponse({ jsonrpc: "2.0", id: "invocation-1", result: { isError: false, content: [{ text: "missing type" }] } }, "invocation-1"); }).toThrow(/invalid/);
		expect(function _MissingText() { __ParseMcpExecutorToolCallResponse({ jsonrpc: "2.0", id: "invocation-1", result: { isError: false, content: [{ type: "text" }] } }, "invocation-1"); }).toThrow(/invalid/);
		expect(function _UnknownType() { __ParseMcpExecutorToolCallResponse({ jsonrpc: "2.0", id: "invocation-1", result: { isError: false, content: [{ type: "invented", payload: true }] } }, "invocation-1"); }).toThrow(/invalid/);
	});
});
