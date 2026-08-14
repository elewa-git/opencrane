import type { AgUiStreamState } from "../ag-ui-stream.types.js";
import { _IsAgentThreadParentDelivery } from "./agent-thread-delivery.validator.js";

/** Adopt one exact display-safe immediate-parent delivery; runtime authority fields are rejected. */
export function _AgentThreadParentDelivery(state: AgUiStreamState, value: unknown, name: string): AgUiStreamState
{
	if (!_IsAgentThreadParentDelivery(value)) throw new Error("AG-UI Agent-thread parent delivery is invalid");
	const existing = state.agentThreadParentDeliveries[value.id];
	if (existing !== undefined && JSON.stringify(existing) !== JSON.stringify(value)) throw new Error("AG-UI Agent-thread parent delivery changed payload");
	if (existing !== undefined) return state;
	return { ...state, agentThreadParentDeliveries: { ...state.agentThreadParentDeliveries, [value.id]: value }, customEvents: [...state.customEvents, name] };
}
