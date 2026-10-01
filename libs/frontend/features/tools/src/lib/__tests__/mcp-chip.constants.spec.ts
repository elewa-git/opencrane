import { describe, expect, it } from "vitest";

import { McpConnectionStatus } from "@opencrane/core";

import { MCP_CONNECTION_INDICATORS } from "../mcp-chip.constants";

describe("MCP connection indicators", () =>
{
	it("presents every server-owned connection state", () =>
	{
		expect(Object.keys(MCP_CONNECTION_INDICATORS).toSorted()).toEqual(Object.values(McpConnectionStatus).toSorted());
		expect(MCP_CONNECTION_INDICATORS[McpConnectionStatus.Activating]).toMatchObject({ label: "Activating", pulse: true });
		expect(MCP_CONNECTION_INDICATORS[McpConnectionStatus.Active]).toMatchObject({ label: "Active", pulse: false });
		expect(MCP_CONNECTION_INDICATORS[McpConnectionStatus.RecoveryRequired]).toMatchObject({ label: "Recovery required", pulse: false });
	});
});
