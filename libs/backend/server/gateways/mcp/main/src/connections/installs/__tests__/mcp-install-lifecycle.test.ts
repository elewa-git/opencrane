import { describe, expect, it } from "vitest";

import { McpInstallStates } from "@opencrane/contracts";

import { __PlanMcpInstallLifecycle, McpInstallLifecycleActions, McpInstallLifecycleEvents } from "../mcp-install-lifecycle";

describe("MCP install lifecycle", () =>
{
	it("requires cleanup before removal completes and permits a later reinstall", () =>
	{
		expect(__PlanMcpInstallLifecycle(McpInstallStates.Installed, McpInstallLifecycleEvents.UninstallWithoutConnection)).toEqual({ action: McpInstallLifecycleActions.Advance, state: McpInstallStates.Removed });
		expect(__PlanMcpInstallLifecycle(McpInstallStates.Installed, McpInstallLifecycleEvents.UninstallWithConnection)).toEqual({ action: McpInstallLifecycleActions.Advance, state: McpInstallStates.Removing });
		expect(__PlanMcpInstallLifecycle(McpInstallStates.Removing, McpInstallLifecycleEvents.Reinstall)).toEqual({ action: McpInstallLifecycleActions.Deny, state: McpInstallStates.Removing });
		expect(__PlanMcpInstallLifecycle(McpInstallStates.Removing, McpInstallLifecycleEvents.CleanupCompleted)).toEqual({ action: McpInstallLifecycleActions.Advance, state: McpInstallStates.Removed });
		expect(__PlanMcpInstallLifecycle(McpInstallStates.Removed, McpInstallLifecycleEvents.Reinstall)).toEqual({ action: McpInstallLifecycleActions.Advance, state: McpInstallStates.Installed });
	});

	it("makes repeated uninstall and completed cleanup idempotent", () =>
	{
		expect(__PlanMcpInstallLifecycle(McpInstallStates.Removing, McpInstallLifecycleEvents.UninstallWithConnection).action).toBe(McpInstallLifecycleActions.NoOp);
		expect(__PlanMcpInstallLifecycle(McpInstallStates.Removed, McpInstallLifecycleEvents.UninstallWithoutConnection).action).toBe(McpInstallLifecycleActions.NoOp);
		expect(__PlanMcpInstallLifecycle(McpInstallStates.Removed, McpInstallLifecycleEvents.CleanupCompleted).action).toBe(McpInstallLifecycleActions.NoOp);
	});
});
