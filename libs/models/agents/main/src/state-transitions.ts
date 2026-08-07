import type { AgentRevisionState } from "./agent-revision.types.js";
import type { AgentRunState } from "./agent-run.types.js";
import type { AgentServiceState } from "./agent-service.types.js";
import type { MessageState, RunEvent, ThreadState } from "./transcript.types.js";

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
	running: ["waiting_for_approval", "completed", "failed", "cancelling"],
	waiting_for_approval: ["running", "failed", "cancelling"],
	cancelling: ["cancelled"],
	completed: [],
	failed: [],
	cancelled: [],
};

/** Legal next states for each canonical thread state. */
const _THREAD_TRANSITIONS: Readonly<Record<ThreadState, readonly ThreadState[]>> = {
	active: ["archived"],
	archived: ["active"],
};

/** Legal next states for each message assembly state. */
const _MESSAGE_TRANSITIONS: Readonly<Record<MessageState, readonly MessageState[]>> = {
	pending: ["streaming", "completed", "failed", "cancelled"],
	streaming: ["completed", "failed", "cancelled"],
	completed: [],
	failed: [],
	cancelled: [],
};

/** Determines whether an agent service may move directly to the requested state. */
export function __IsAgentServiceTransitionAllowed(current: AgentServiceState, next: AgentServiceState): boolean
{
	return _AGENT_SERVICE_TRANSITIONS[current].includes(next);
}

/** Determines whether an immutable agent revision may move directly to the requested state. */
export function __IsAgentRevisionTransitionAllowed(current: AgentRevisionState, next: AgentRevisionState): boolean
{
	return _AGENT_REVISION_TRANSITIONS[current].includes(next);
}

/** Determines whether an agent run may move directly to the requested durable state. */
export function __IsAgentRunTransitionAllowed(current: AgentRunState, next: AgentRunState): boolean
{
	return _AGENT_RUN_TRANSITIONS[current].includes(next);
}

/** Determines whether a canonical thread may move directly to the requested state. */
export function __IsThreadTransitionAllowed(current: ThreadState, next: ThreadState): boolean
{
	return _THREAD_TRANSITIONS[current].includes(next);
}

/** Determines whether a transcript message may move directly to the requested assembly state. */
export function __IsMessageTransitionAllowed(current: MessageState, next: MessageState): boolean
{
	return _MESSAGE_TRANSITIONS[current].includes(next);
}

/**
 * Determines whether an event can be appended to one contiguous persisted run stream.
 * The first event is sequence one and later events must match the run and increment by one.
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
