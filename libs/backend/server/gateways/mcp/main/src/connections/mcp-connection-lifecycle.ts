import { McpConnectionStates } from "./mcp-connection.types";
import { McpConnectionLifecycleActions, McpConnectionLifecycleEvents, type McpConnectionLifecycleDecision } from "./mcp-connection-lifecycle.types";

export { McpConnectionLifecycleActions, McpConnectionLifecycleEvents } from "./mcp-connection-lifecycle.types";
export type { McpConnectionLifecycleDecision } from "./mcp-connection-lifecycle.types";

const _DENY = McpConnectionLifecycleActions.Deny;
const _NO_OP = McpConnectionLifecycleActions.NoOp;
const _ADVANCE = McpConnectionLifecycleActions.Advance;

/** Exhaustive State by Event policy for one immutable connection generation. */
const _POLICY: Readonly<Record<McpConnectionStates, Readonly<Record<McpConnectionLifecycleEvents, McpConnectionLifecycleDecision>>>> = {
	[McpConnectionStates.AwaitingMaterial]: {
		[McpConnectionLifecycleEvents.CustodyBound]: { action: _ADVANCE, state: McpConnectionStates.Activating },
		[McpConnectionLifecycleEvents.CustodyUncertain]: { action: _ADVANCE, state: McpConnectionStates.RecoveryRequired },
		[McpConnectionLifecycleEvents.DiscoveryCompleted]: { action: _DENY, state: McpConnectionStates.AwaitingMaterial },
		[McpConnectionLifecycleEvents.DiscoveryFailed]: { action: _DENY, state: McpConnectionStates.AwaitingMaterial },
		[McpConnectionLifecycleEvents.Revoke]: { action: _ADVANCE, state: McpConnectionStates.Revoked },
	},
	[McpConnectionStates.Activating]: {
		[McpConnectionLifecycleEvents.CustodyBound]: { action: _NO_OP, state: McpConnectionStates.Activating },
		[McpConnectionLifecycleEvents.CustodyUncertain]: { action: _ADVANCE, state: McpConnectionStates.RecoveryRequired },
		[McpConnectionLifecycleEvents.DiscoveryCompleted]: { action: _ADVANCE, state: McpConnectionStates.Active },
		[McpConnectionLifecycleEvents.DiscoveryFailed]: { action: _ADVANCE, state: McpConnectionStates.Failed },
		[McpConnectionLifecycleEvents.Revoke]: { action: _ADVANCE, state: McpConnectionStates.Revoked },
	},
	[McpConnectionStates.Active]: {
		[McpConnectionLifecycleEvents.CustodyBound]: { action: _NO_OP, state: McpConnectionStates.Active },
		[McpConnectionLifecycleEvents.CustodyUncertain]: { action: _DENY, state: McpConnectionStates.Active },
		[McpConnectionLifecycleEvents.DiscoveryCompleted]: { action: _NO_OP, state: McpConnectionStates.Active },
		[McpConnectionLifecycleEvents.DiscoveryFailed]: { action: _DENY, state: McpConnectionStates.Active },
		[McpConnectionLifecycleEvents.Revoke]: { action: _ADVANCE, state: McpConnectionStates.Revoked },
	},
	[McpConnectionStates.Revoked]: {
		[McpConnectionLifecycleEvents.CustodyBound]: { action: _DENY, state: McpConnectionStates.Revoked },
		[McpConnectionLifecycleEvents.CustodyUncertain]: { action: _DENY, state: McpConnectionStates.Revoked },
		[McpConnectionLifecycleEvents.DiscoveryCompleted]: { action: _DENY, state: McpConnectionStates.Revoked },
		[McpConnectionLifecycleEvents.DiscoveryFailed]: { action: _DENY, state: McpConnectionStates.Revoked },
		[McpConnectionLifecycleEvents.Revoke]: { action: _NO_OP, state: McpConnectionStates.Revoked },
	},
	[McpConnectionStates.Failed]: {
		[McpConnectionLifecycleEvents.CustodyBound]: { action: _DENY, state: McpConnectionStates.Failed },
		[McpConnectionLifecycleEvents.CustodyUncertain]: { action: _DENY, state: McpConnectionStates.Failed },
		[McpConnectionLifecycleEvents.DiscoveryCompleted]: { action: _DENY, state: McpConnectionStates.Failed },
		[McpConnectionLifecycleEvents.DiscoveryFailed]: { action: _NO_OP, state: McpConnectionStates.Failed },
		[McpConnectionLifecycleEvents.Revoke]: { action: _ADVANCE, state: McpConnectionStates.Revoked },
	},
	[McpConnectionStates.RecoveryRequired]: {
		[McpConnectionLifecycleEvents.CustodyBound]: { action: _DENY, state: McpConnectionStates.RecoveryRequired },
		[McpConnectionLifecycleEvents.CustodyUncertain]: { action: _NO_OP, state: McpConnectionStates.RecoveryRequired },
		[McpConnectionLifecycleEvents.DiscoveryCompleted]: { action: _DENY, state: McpConnectionStates.RecoveryRequired },
		[McpConnectionLifecycleEvents.DiscoveryFailed]: { action: _DENY, state: McpConnectionStates.RecoveryRequired },
		[McpConnectionLifecycleEvents.Revoke]: { action: _ADVANCE, state: McpConnectionStates.Revoked },
	},
};

/** Decide one durable connection transition without performing persistence. */
export function __PlanMcpConnectionLifecycle(state: McpConnectionStates, event: McpConnectionLifecycleEvents): McpConnectionLifecycleDecision
{
	return _POLICY[state][event];
}
