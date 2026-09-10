import { describe, expect, it } from "vitest";

import { MCP_PROTOCOL_VERSION, McpProtocolError, ___BuildMcpDiscoveryRequest, ___BuildMcpRequestHeaders, ___BuildMcpToolCallRequest, ___BuildMcpToolsListRequest, ___ParseMcpDiscoveredTools, ___ParseMcpDiscoveryResponse, ___ParseMcpToolCallResponse, ___ParseMcpToolCallResult, ___ParseMcpToolsListResponse } from "../index";

/** Builds a JSON-RPC result envelope for a test request. */
function _Result(id: string, result: unknown): unknown
{
	return { jsonrpc: "2.0", id, result };
}

/** Adds the cache hints required by MCP discovery and list results. */
function _Cacheable(result: Record<string, unknown>): Record<string, unknown>
{
	return { ...result, ttlMs: 3_600_000, cacheScope: "public" };
}

describe("MCP 2026-07-28 protocol", function _DescribeProtocol()
{
	it("adds namespaced metadata to every request", function _BuildRequests()
	{
		const metadata = { "io.modelcontextprotocol/protocolVersion": MCP_PROTOCOL_VERSION, "io.modelcontextprotocol/clientCapabilities": {} };
		expect(___BuildMcpDiscoveryRequest()).toEqual({ jsonrpc: "2.0", id: "opencrane-mcp-discovery", method: "server/discover", params: { _meta: metadata } });
		expect(___BuildMcpDiscoveryRequest("probe", "future-version")).toMatchObject({ id: "probe", params: { _meta: { "io.modelcontextprotocol/protocolVersion": "future-version" } } });
		expect(___BuildMcpToolsListRequest("page-2")).toEqual({ jsonrpc: "2.0", id: "opencrane-mcp-tools", method: "tools/list", params: { cursor: "page-2", _meta: metadata } });
		expect(___BuildMcpToolCallRequest("invocation-1", "weather.read", { city: "Nairobi" })).toMatchObject({ id: "invocation-1", method: "tools/call", params: { name: "weather.read", arguments: { city: "Nairobi" }, _meta: metadata } });
	});

	it("builds standard and schema-selected HTTP headers", function _BuildHeaders()
	{
		const request = ___BuildMcpToolCallRequest("invocation-1", "weather 世界", { routing: { region: " east " }, active: true, count: 7, empty: null });
		const schema = { type: "object", properties: { routing: { type: "object", properties: { region: { type: "string", "x-mcp-header": "Region" } } }, active: { type: "boolean", "x-mcp-header": "Active" }, count: { type: "integer", "x-mcp-header": "Count" }, empty: { type: "string", "x-mcp-header": "Empty" } } };
		expect(___BuildMcpRequestHeaders(request, schema)).toEqual({ Accept: "application/json, text/event-stream", "Content-Type": "application/json", "MCP-Protocol-Version": MCP_PROTOCOL_VERSION, "Mcp-Method": "tools/call", "Mcp-Name": "=?base64?d2VhdGhlciDkuJbnlYw=?=", "Mcp-Param-Region": "=?base64?IGVhc3Qg?=", "Mcp-Param-Active": "true", "Mcp-Param-Count": "7" });
		expect(___BuildMcpRequestHeaders(___BuildMcpDiscoveryRequest())).toEqual({ Accept: "application/json, text/event-stream", "Content-Type": "application/json", "MCP-Protocol-Version": MCP_PROTOCOL_VERSION, "Mcp-Method": "server/discover" });
	});

	it("rejects unsafe or unreachable header annotations", function _RejectHeaders()
	{
		const request = ___BuildMcpToolCallRequest("invocation-1", "tool", { value: "ok" });
		expect(function _Duplicate() { ___BuildMcpRequestHeaders(request, { type: "object", properties: { first: { type: "string", "x-mcp-header": "Route" }, second: { type: "string", "x-mcp-header": "route" } } }); }).toThrow(McpProtocolError);
		expect(function _ArrayPath() { ___BuildMcpRequestHeaders(request, { type: "object", items: { type: "string", "x-mcp-header": "Route" } }); }).toThrow(McpProtocolError);
		expect(function _Number() { ___BuildMcpRequestHeaders(request, { type: "object", properties: { value: { type: "number", "x-mcp-header": "Route" } } }); }).toThrow(McpProtocolError);
	});

	it("accepts discovery offers without choosing a revision", function _ParseDiscovery()
	{
		const result = _Cacheable({ resultType: "complete", supportedVersions: ["future-version"], capabilities: { tools: {} } });
		expect(___ParseMcpDiscoveryResponse(_Result("probe", result), "probe")).toEqual(result);
		expect(function _BlankVersion() { ___ParseMcpDiscoveryResponse(_Result("probe", _Cacheable({ resultType: "complete", supportedVersions: [" \t"], capabilities: {} })), "probe"); }).toThrow(/invalid/u);
		expect(function _InputRequired() { ___ParseMcpDiscoveryResponse(_Result("probe", { resultType: "input_required", supportedVersions: [MCP_PROTOCOL_VERSION] }), "probe"); }).toThrow(/invalid/u);
		expect(function _MissingCapabilities() { ___ParseMcpDiscoveryResponse(_Result("probe", _Cacheable({ resultType: "complete", supportedVersions: [MCP_PROTOCOL_VERSION] })), "probe"); }).toThrow(/invalid/u);
		expect(function _FractionalTtl() { ___ParseMcpDiscoveryResponse(_Result("probe", { ...result, ttlMs: 0.5 }), "probe"); }).toThrow(/invalid/u);
		expect(function _UnknownScope() { ___ParseMcpDiscoveryResponse(_Result("probe", { ...result, cacheScope: "shared" }), "probe"); }).toThrow(/invalid/u);
	});

	it("projects a paginated tool list and ignores optional display metadata", function _ParseTools()
	{
		const tool = { name: "weather.read", title: "Weather", description: "Reads weather", icons: [{ src: "https://example.com/icon.png" }], annotations: { readOnlyHint: true }, inputSchema: { type: "object" }, outputSchema: { type: "object" }, _meta: { source: "provider" } };
		expect(___ParseMcpToolsListResponse(_Result("opencrane-mcp-tools", _Cacheable({ resultType: "complete", tools: [tool], nextCursor: "page-2" })))).toEqual({ tools: [{ name: "weather.read", description: "Reads weather", inputSchema: { type: "object" } }], nextCursor: "page-2" });
		const invalidHeaderTool = { ...tool, name: "invalid", inputSchema: { type: "object", properties: { value: { type: "number", "x-mcp-header": "Route" } } } };
		expect(___ParseMcpToolsListResponse(_Result("opencrane-mcp-tools", _Cacheable({ resultType: "complete", tools: [tool, invalidHeaderTool] }))).tools).toHaveLength(1);
		expect(function _MissingCacheHints() { ___ParseMcpToolsListResponse(_Result("opencrane-mcp-tools", { resultType: "complete", tools: [tool] })); }).toThrow(/invalid/u);
	});

	it("keeps strict durable tool projections", function _ParseDurableTools()
	{
		const tool = { name: "weather.read", description: null, inputSchema: { type: "object" } };
		expect(___ParseMcpDiscoveredTools([tool])).toEqual([tool]);
		expect(function _UnknownField() { ___ParseMcpDiscoveredTools([{ ...tool, title: "Display only" }]); }).toThrow(/invalid/u);
		expect(function _Duplicate() { ___ParseMcpDiscoveredTools([tool, tool]); }).toThrow(/duplicated/u);
	});

	it("projects completed structured results and rejects input-required results", function _ParseCall()
	{
		const external = _Result("invocation-1", { resultType: "complete", content: [{ type: "text", text: "ready" }], structuredContent: [1, 2] });
		expect(___ParseMcpToolCallResponse(external, "invocation-1")).toEqual({ isError: false, content: [{ type: "text", text: "ready" }], structuredContent: [1, 2] });
		expect(___ParseMcpToolCallResult({ isError: true, content: [] })).toEqual({ isError: true, content: [] });
		expect(function _InputRequired() { ___ParseMcpToolCallResponse(_Result("invocation-1", { resultType: "input_required", inputRequests: {} }), "invocation-1"); }).toThrow(/did not complete/u);
		expect(function _WireDiscriminator() { ___ParseMcpToolCallResult({ resultType: "complete", isError: false, content: [] }); }).toThrow(/invalid/u);
	});
});
