import { describe, expect, it } from "vitest";

import { __PlanMcpConnectionLifecycle } from "../mcp-connection-lifecycle";
import { McpConnectionLifecycleActions, McpConnectionLifecycleEvents } from "../mcp-connection-lifecycle.types";
import { McpConnectionStates } from "../mcp-connection.types";

describe("MCP connection lifecycle", () =>
{
	it("defines every State by Event decision", () =>
	{
		for (const state of Object.values(McpConnectionStates))
		{
			for (const event of Object.values(McpConnectionLifecycleEvents))
				expect(__PlanMcpConnectionLifecycle(state, event)).toMatchObject({ action: expect.any(String), state: expect.any(String) });
		}
	});

	it("blocks late custody and discovery after revocation", () =>
	{
		expect(__PlanMcpConnectionLifecycle(McpConnectionStates.Revoked, McpConnectionLifecycleEvents.CustodyBound).action).toBe(McpConnectionLifecycleActions.Deny);
		expect(__PlanMcpConnectionLifecycle(McpConnectionStates.Revoked, McpConnectionLifecycleEvents.DiscoveryCompleted).action).toBe(McpConnectionLifecycleActions.Deny);
		expect(__PlanMcpConnectionLifecycle(McpConnectionStates.Revoked, McpConnectionLifecycleEvents.Revoke).action).toBe(McpConnectionLifecycleActions.NoOp);
	});

	it("allows only explicit revocation to leave recovery-required", () =>
	{
		const expected: Readonly<Record<McpConnectionLifecycleEvents, McpConnectionLifecycleActions>> = {
			[McpConnectionLifecycleEvents.CustodyBound]: McpConnectionLifecycleActions.Deny,
			[McpConnectionLifecycleEvents.CustodyUncertain]: McpConnectionLifecycleActions.NoOp,
			[McpConnectionLifecycleEvents.DiscoveryCompleted]: McpConnectionLifecycleActions.Deny,
			[McpConnectionLifecycleEvents.DiscoveryFailed]: McpConnectionLifecycleActions.Deny,
			[McpConnectionLifecycleEvents.Revoke]: McpConnectionLifecycleActions.Advance,
		};
		for (const event of Object.values(McpConnectionLifecycleEvents))
		{
			const decision = __PlanMcpConnectionLifecycle(McpConnectionStates.RecoveryRequired, event);
			expect(decision.action).toBe(expected[event]);
		}
	});
});
