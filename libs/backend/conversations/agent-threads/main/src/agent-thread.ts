import type { AgentThreadTarget, AgentThreadTargetDecision } from "./agent-thread.types.js";

/** Maximum stable identifier length accepted at the dependency-light target boundary. */
const _IDENTIFIER_LIMIT = 128;

/** Validates the shape of an exact Agent target before any persistence authority is consulted. */
export function __DecideAgentThreadTarget(target: AgentThreadTarget): AgentThreadTargetDecision
{
	const value = target.agentServiceId;
	return value === value.trim() && value.length > 0 && value.length <= _IDENTIFIER_LIMIT ? { allowed: true } : { allowed: false };
}
