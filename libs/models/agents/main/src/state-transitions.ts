import type { AgentRevisionState } from "./agent-revision.types.js";
import type { AgentRunState } from "./agent-run.types.js";
import type { AgentServiceState } from "./agent-service.types.js";
import type { RunEvent } from "./run-event.types.js";

/** Legal next states for each agent-service lifecycle state. */
const _AGENT_SERVICE_TRANSITIONS: Readonly<Record<AgentServiceState, readonly AgentServiceState[]>> = {
	draft: ["active", "retired"],
	active: ["paused", "retired"],
	paused: ["active", "retired"],
	retired: [],
};

/** Legal next states for each immutable agent-revision state. */
const _AGENT_REVISION_TRANSITIONS: Readonly<Record<AgentRevisionState, readonly AgentRevisionState[]>> = {
	draft: ["published", "rejected"],
	published: ["retired"],
	rejected: [],
	retired: [],
};

/** Legal next states for each durable agent-run state. */
const _AGENT_RUN_TRANSITIONS: Readonly<Record<AgentRunState, readonly AgentRunState[]>> = {
	accepted: ["queued", "failed", "cancelling"],
	queued: ["assigned", "failed", "cancelling"],
	assigned: ["running", "failed", "cancelling"],
	running: ["waiting_for_input", "recovery_required", "completed", "failed", "cancelling"],
	waiting_for_input: ["running", "recovery_required", "failed", "cancelling"],
	recovery_required: ["running", "failed", "cancelling"],
	cancelling: ["cancelled"],
	completed: [],
	failed: [],
	cancelled: [],
};

/**
 * Return whether an agent service may move straight from one state to another.
 *
 * Only the moves in the table above are legal; everything else, including staying in the same
 * state, returns false. `retired` is terminal. Call this before writing a state change so an
 * illegal transition is rejected rather than persisted.
 *
 * No caller outside this package's tests yet — the state tables are the contract other packages
 * are expected to check against.
 * @param current - The service's stored state.
 * @param next - The state being requested.
 * @returns True only for a legal direct move.
 */
export function __IsAgentServiceTransitionAllowed(current: AgentServiceState, next: AgentServiceState): boolean
{
	return _AGENT_SERVICE_TRANSITIONS[current].includes(next);
}

/** Return whether an agent revision may move straight from one state to another. Only the moves in the table above are legal; `rejected` and `retired` are terminal. */
export function __IsAgentRevisionTransitionAllowed(current: AgentRevisionState, next: AgentRevisionState): boolean
{
	return _AGENT_REVISION_TRANSITIONS[current].includes(next);
}

/** Return whether an agent run may move straight from one state to another. Only the moves in the table above are legal; `completed`, `failed`, and `cancelled` are terminal. */
export function __IsAgentRunTransitionAllowed(current: AgentRunState, next: AgentRunState): boolean
{
	return _AGENT_RUN_TRANSITIONS[current].includes(next);
}

/**
 * Return whether an event may be appended to a run's event stream.
 *
 * The stream has no gaps: the first event is sequence 1, and every later event must belong to the
 * same run and be exactly one higher than the previous. Pass `null` as `previous` for the first
 * event. A false result means the caller is about to create a gap or a duplicate, which would
 * make replay and cursors unreliable.
 *
 * No caller outside this package's tests yet — the rule is the contract writers check against.
 * @param previous - The last stored event for this run, or null when the stream is empty.
 * @param next - The event about to be appended.
 * @returns True only when appending keeps the stream contiguous and in one run.
 */
export function __CanAppendRunEvent(previous: RunEvent | null, next: RunEvent): boolean
{
	if (!Number.isSafeInteger(next.sequence) || next.sequence < 1)
	{
		return false;
	}

	if (previous === null)
	{
		return next.sequence === 1;
	}

	return previous.runId === next.runId && next.sequence === previous.sequence + 1;
}
