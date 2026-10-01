import { describe, expect, it } from "vitest";

import { _IsModelToolNameValid, _McpModelToolName } from "../mcp-model-tool-name";

describe("MCP model tool names", function _McpModelToolNameSuite()
{
	it("derives the fixed versioned alias from the exact immutable revision", function _DerivesAlias()
	{
		expect(_McpModelToolName("tool-1")).toBe("mcp_N7odFteZclDmu0DFKlJhoEt53tfHx79bYbz59tNqNu0");
		expect(_McpModelToolName("tool-1")).toHaveLength(47);
		expect(_IsModelToolNameValid(_McpModelToolName("tool-1"))).toBe(true);
	});

	it("distinguishes revisions whose source names could normalize to the same provider name", function _DistinguishesRevisions()
	{
		expect(_McpModelToolName("revision-dotted")).toBe("mcp_wWKT_5cFG66QdMscL6hmB1XTsZzT1bRj_Sij6ljOg_c");
		expect(_McpModelToolName("revision-long")).toBe("mcp_lRn5FnpMinTXKgKT50uzqB-Xj5FKgtUNVaiZEh_odWk");
		expect(_McpModelToolName("revision-dotted")).not.toBe(_McpModelToolName("revision-long"));
	});

	it("rejects a missing or whitespace-altered revision coordinate", function _RejectsInvalidRevision()
	{
		expect(function _Empty(): string { return _McpModelToolName(""); }).toThrow(/exact non-empty revision/);
		expect(function _Whitespace(): string { return _McpModelToolName(" revision-1"); }).toThrow(/exact non-empty revision/);
		expect(_IsModelToolNameValid(undefined)).toBe(false);
		expect(_IsModelToolNameValid(null)).toBe(false);
	});
});
