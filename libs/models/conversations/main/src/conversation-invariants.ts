import { ConversationLifecycles, ConversationModes } from "./conversation.types.js";
import { MessageStates, type Message } from "./message.types.js";
import type { ConversationTimelineEntry } from "./timeline.types.js";

/** Legal next lifecycle values for each current conversation lifecycle. */
const _CONVERSATION_LIFECYCLE_TRANSITIONS: Readonly<Record<ConversationLifecycles, readonly ConversationLifecycles[]>> = {
	[ConversationLifecycles.Open]: [ConversationLifecycles.Closed],
	[ConversationLifecycles.Closed]: [],
};

/** Legal next assembly states for each current message state. */
const _MESSAGE_TRANSITIONS: Readonly<Record<MessageStates, readonly MessageStates[]>> = {
	[MessageStates.Pending]: [MessageStates.Streaming, MessageStates.Completed, MessageStates.Failed, MessageStates.Cancelled],
	[MessageStates.Streaming]: [MessageStates.Completed, MessageStates.Failed, MessageStates.Cancelled],
	[MessageStates.Completed]: [],
	[MessageStates.Failed]: [],
	[MessageStates.Cancelled]: [],
};

/** Determines whether a mode has exactly its required or prohibited agent-service binding. */
export function __HasValidConversationAgentBinding(mode: ConversationModes, agentServiceId: string | null | undefined): boolean
{
	if (mode === ConversationModes.AgentSession)
	{
		return typeof agentServiceId === "string" && agentServiceId.trim().length > 0;
	}

	if (mode === ConversationModes.Direct || mode === ConversationModes.Group)
	{
		return agentServiceId === null || agentServiceId === undefined;
	}

	return false;
}

/** Determines whether a conversation may make the requested direct monotonic lifecycle transition. */
export function __IsConversationLifecycleTransitionAllowed(current: ConversationLifecycles, next: ConversationLifecycles): boolean
{
	return _CONVERSATION_LIFECYCLE_TRANSITIONS[current].includes(next);
}

/** Determines whether a canonical message may make the requested direct assembly transition. */
export function __IsMessageTransitionAllowed(current: MessageStates, next: MessageStates): boolean
{
	return _MESSAGE_TRANSITIONS[current].includes(next);
}

/**
 * Determines whether a timeline entry can follow one database-owned conversation position.
 * The first entry is position one and later entries stay in one conversation without gaps.
 */
export function __CanAppendConversationTimelineEntry(previous: ConversationTimelineEntry | null, next: ConversationTimelineEntry): boolean
{
	if (!/^[1-9]\d*$/.test(next.position))
	{
		return false;
	}

	if (previous === null)
	{
		return next.position === "1";
	}

	if (!/^[1-9]\d*$/.test(previous.position))
	{
		return false;
	}

	return previous.conversationId === next.conversationId && BigInt(next.position) === BigInt(previous.position) + 1n;
}

/** Determines whether a completed-at timestamp agrees with the message's assembly state. */
export function __HasValidMessageCompletion(message: Message): boolean
{
	const terminalStates: readonly MessageStates[] = [MessageStates.Completed, MessageStates.Failed, MessageStates.Cancelled];
	return terminalStates.includes(message.state) === (message.completedAt !== null);
}
