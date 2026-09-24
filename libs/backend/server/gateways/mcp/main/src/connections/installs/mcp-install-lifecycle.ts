import { McpInstallStates } from "@opencrane/contracts";

import { McpInstallLifecycleActions, McpInstallLifecycleEvents, type McpInstallLifecycleDecision } from "./mcp-install-lifecycle.types";

export { McpInstallLifecycleActions, McpInstallLifecycleEvents } from "./mcp-install-lifecycle.types";
export type { McpInstallLifecycleDecision } from "./mcp-install-lifecycle.types";

const _ADVANCE = McpInstallLifecycleActions.Advance;
const _NO_OP = McpInstallLifecycleActions.NoOp;
const _DENY = McpInstallLifecycleActions.Deny;

/** Exhaustive State by Event policy for one retained MCP installation. */
const _POLICY: Readonly<Record<McpInstallStates, Readonly<Record<McpInstallLifecycleEvents, McpInstallLifecycleDecision>>>> = {
	[McpInstallStates.Installed]: {
		[McpInstallLifecycleEvents.UninstallWithoutConnection]: { action: _ADVANCE, state: McpInstallStates.Removed },
		[McpInstallLifecycleEvents.UninstallWithConnection]: { action: _ADVANCE, state: McpInstallStates.Removing },
		[McpInstallLifecycleEvents.CleanupCompleted]: { action: _DENY, state: McpInstallStates.Installed },
		[McpInstallLifecycleEvents.Reinstall]: { action: _NO_OP, state: McpInstallStates.Installed },
	},
	[McpInstallStates.Removing]: {
		[McpInstallLifecycleEvents.UninstallWithoutConnection]: { action: _NO_OP, state: McpInstallStates.Removing },
		[McpInstallLifecycleEvents.UninstallWithConnection]: { action: _NO_OP, state: McpInstallStates.Removing },
		[McpInstallLifecycleEvents.CleanupCompleted]: { action: _ADVANCE, state: McpInstallStates.Removed },
		[McpInstallLifecycleEvents.Reinstall]: { action: _DENY, state: McpInstallStates.Removing },
	},
	[McpInstallStates.Removed]: {
		[McpInstallLifecycleEvents.UninstallWithoutConnection]: { action: _NO_OP, state: McpInstallStates.Removed },
		[McpInstallLifecycleEvents.UninstallWithConnection]: { action: _NO_OP, state: McpInstallStates.Removed },
		[McpInstallLifecycleEvents.CleanupCompleted]: { action: _NO_OP, state: McpInstallStates.Removed },
		[McpInstallLifecycleEvents.Reinstall]: { action: _ADVANCE, state: McpInstallStates.Installed },
	},
};

/** Decide one retained install transition without performing persistence. */
export function __PlanMcpInstallLifecycle(state: McpInstallStates, event: McpInstallLifecycleEvents): McpInstallLifecycleDecision
{
	return _POLICY[state][event];
}
