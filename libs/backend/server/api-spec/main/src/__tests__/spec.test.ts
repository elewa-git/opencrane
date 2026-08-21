import { describe, expect, it } from "vitest";

import { spec } from "../spec";

describe("MCP public API contract", function _Suite()
{
	it("publishes only the principal- and silo-bound MCP surface", function _Test()
	{
		expect(spec.paths).toHaveProperty("/mcp/catalog");
		expect(spec.paths).toHaveProperty("/mcp/servers");
		expect(spec.paths).not.toHaveProperty("/mcp-servers");
		expect(spec.paths).not.toHaveProperty("/mcp-servers/{id}");
		expect(spec.components.schemas).not.toHaveProperty("McpServerCredential");
	});
});
