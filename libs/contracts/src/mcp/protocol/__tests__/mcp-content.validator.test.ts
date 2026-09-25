import { describe, expect, it } from "vitest";

import { ___ParseMcpToolCallResponse, ___ParseMcpToolCallResult } from "../index";

/** Wraps content in the strict durable result shape. */
function _Durable(content: unknown): unknown
{
	return { isError: false, content };
}

/** Wraps content in a completed external tool response. */
function _External(content: unknown, extra: Record<string, unknown> = {}): unknown
{
	return { jsonrpc: "2.0", id: "invocation-1", result: { resultType: "complete", isError: false, content, ...extra } };
}

describe("MCP content validation", function _DescribeContent()
{
	it("preserves supported optional content fields", function _ValidOptionalFields()
	{
		const content = [{ type: "text", text: "ready", annotations: { audience: ["assistant"], priority: 0.5, lastModified: "2026-07-28T00:00:00Z" }, _meta: { "com.example/source": "provider" } }, { type: "resource_link", name: "report", uri: "file:///report", title: "Report", description: "Generated report", mimeType: "text/plain", icons: [{ src: "data:image/png;base64,AA==", mimeType: "image/png", sizes: ["48x48"], theme: "light" }], size: 4 }];
		expect(___ParseMcpToolCallResult(_Durable(content)).content).toEqual(content);
		expect(___ParseMcpToolCallResponse(_External(content), "invocation-1").content).toEqual(content);
	});

	it("rejects malformed optional fields and unknown content fields", function _RejectOptionalFields()
	{
		const invalidBlocks = [{ type: "text", text: "ok", annotations: "bad" }, { type: "text", text: "ok", unexpected: true }, { type: "image", data: "AA==", mimeType: "image/png", annotations: { priority: 2 } }, { type: "resource_link", name: "report", uri: "file:///report", icons: [{ src: "icon", unexpected: true }] }];
		for (const block of invalidBlocks)
		{
			expect(function _DurableRejects() { ___ParseMcpToolCallResult(_Durable([block])); }).toThrow(/invalid/u);
			expect(function _ExternalRejects() { ___ParseMcpToolCallResponse(_External([block]), "invocation-1"); }).toThrow(/invalid/u);
		}
	});

	it("requires exactly one embedded resource payload", function _ExclusiveResourcePayload()
	{
		const both = { type: "resource", resource: { uri: "file:///report", text: "plain", blob: "cGxhaW4=" } };
		expect(function _DurableRejects() { ___ParseMcpToolCallResult(_Durable([both])); }).toThrow(/invalid/u);
		expect(function _ExternalRejects() { ___ParseMcpToolCallResponse(_External([both]), "invocation-1"); }).toThrow(/invalid/u);
	});

	it("drops JSON-safe external result extensions but keeps durable results strict", function _ProjectOuterExtensions()
	{
		const response = ___ParseMcpToolCallResponse(_External([], { "com.example/receipt": { id: "provider-1" }, structuredContent: { ok: true } }), "invocation-1");
		expect(response).toEqual({ isError: false, content: [], structuredContent: { ok: true } });
		expect(function _DurableRejects() { ___ParseMcpToolCallResult({ ...response, "com.example/receipt": { id: "provider-1" } }); }).toThrow(/invalid/u);
	});
});
