import { AgentThreadGatewayError, AgentThreadGatewayErrorKinds } from "./agent-thread-gateway.errors";
import { AgentThreadRouteStates } from "./agent-thread-state.types";

/** Decide whether one gateway failure requires a non-disclosing route-state transition. */
export function __AgentThreadFailureRoute(error: unknown, hadAuthorizedSnapshot: boolean): AgentThreadRouteStates.AccessChanged | AgentThreadRouteStates.Unavailable | null
{
	if (!(error instanceof AgentThreadGatewayError)) return null;
	if (error.kind === AgentThreadGatewayErrorKinds.AccessChanged && hadAuthorizedSnapshot) return AgentThreadRouteStates.AccessChanged;
	if (error.kind === AgentThreadGatewayErrorKinds.Unavailable || error.kind === AgentThreadGatewayErrorKinds.AccessChanged) return AgentThreadRouteStates.Unavailable;
	return null;
}
