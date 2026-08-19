import { ConversationLifecycles, ConversationModes } from "./conversation.types";
import { MessageStates, type Message } from "./message.types";
import type { ConversationTimelineEntry } from "./timeline.types";

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

/**
 * Determine whether a conversation's mode and agent binding agree.
 *
 * `AgentSession` requires a non-blank agent service id. `Direct` and `Group` require none at all.
 * Any unknown mode returns false, so a stored row from another version fails closed rather than
 * being treated as valid.
 *
 * Called by: {@link __DecideConversationCommand}; re-exported through `@opencrane/contracts`.
 * @param mode - The conversation's stored mode.
 * @param agentServiceId - The stored agent service id, if any.
 * @returns True only when the pairing is legal for that mode.
 */
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

/** Determine whether a conversation may move straight from one lifecycle state to another. Only open-to-closed is legal; closed is terminal and staying put is not a transition. */
export function __IsConversationLifecycleTransitionAllowed(current: ConversationLifecycles, next: ConversationLifecycles): boolean
{
	return _CONVERSATION_LIFECYCLE_TRANSITIONS[current].includes(next);
}

/** Determine whether a message may move straight from one assembly state to another. `Completed`, `Failed`, and `Cancelled` are terminal, so content can never resume. */
export function __IsMessageTransitionAllowed(current: MessageStates, next: MessageStates): boolean
{
	return _MESSAGE_TRANSITIONS[current].includes(next);
}

/**
 * Determine whether one timeline entry may follow another.
 *
 * Pass `null` as `previous` for the first entry, which must be position `"1"`. Every later entry
 * must be in the same conversation and exactly one position higher. A false result means the
 * caller is about to create a gap, a duplicate, or a cross-conversation jump — any of which
 * breaks replay cursors.
 * @param previous - The entry currently at the end of the timeline, or null when it is empty.
 * @param next - The entry about to be appended.
 * @returns True only when appending keeps one conversation's timeline contiguous.
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

/**
 * Checks whether a message projection pairs its assembly state with a completion timestamp.
 *
 * This accepts any projection containing `state` and `completedAt`, so the stored-message schema and
 * frontend response boundary can enforce the same rule without supplying unrelated message fields.
 * `Completed`, `Failed`, and `Cancelled` require a timestamp; `Pending` and `Streaming` require null.
 *
 * Called by: {@link ___MessageSchema} and the conversation-workspace response schema used by
 * `_ParseConversationDetail`.
 * @param message - A message projection containing the state and completion timestamp to compare.
 * @returns True when the timestamp is present exactly for a terminal state; false for either mismatch.
 * @see MessageStates for the states this invariant distinguishes.
 */
export function __HasValidMessageCompletion(message: Pick<Message, "state" | "completedAt">): boolean
{
	const terminalStates: readonly MessageStates[] = [MessageStates.Completed, MessageStates.Failed, MessageStates.Cancelled];
	return terminalStates.includes(message.state) === (message.completedAt !== null);
}
