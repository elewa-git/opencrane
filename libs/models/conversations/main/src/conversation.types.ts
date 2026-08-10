import type { ConversationId } from "./identifiers.types.js";

/**
 * Immutable persisted conversation modes shared by validation and command strategy selection.
 *
 * The readable values are part of the durable model contract and never grant authority by themselves.
 */
export enum ConversationModes
{
	/** A conversation bound to exactly one agent service whose messages enter run admission. */
	AgentSession = "agent_session",
	/** An ordinary conversation between participants that cannot create agent runs. */
	Direct = "direct",
	/** An ordinary multi-participant conversation that cannot create runs for ordinary messages. */
	Group = "group",
}

/**
 * Monotonic persisted conversation lifecycle shared by validation and write admission.
 *
 * The readable values are stable storage and API vocabulary; participant-local archive state is separate.
 */
export enum ConversationLifecycles
{
	/** The conversation may accept commands allowed by its immutable mode. */
	Open = "open",
	/** The conversation is permanently read-only and cannot reopen. */
	Closed = "closed",
}

/** Fields shared by every immutable-mode conversation. */
export interface ConversationBase
{
	/** Stable conversation identifier. */
	readonly id: ConversationId;
	/** Silo in which the conversation and its membership evidence are valid. */
	readonly siloId: string;
	/** Current monotonic lifecycle, independent of participant-local archive visibility. */
	readonly lifecycle: ConversationLifecycles;
	/** Current context-revision identifier, or null before any compaction. */
	readonly contextRevisionId: string | null;
	/** ISO-8601 instant at which lifecycle became closed, or null while open. */
	readonly closedAt: string | null;
	/** ISO-8601 instant at which the conversation was created. */
	readonly createdAt: string;
	/** ISO-8601 instant at which the conversation was last changed. */
	readonly updatedAt: string;
}

/** Agent-bound conversation whose participant input must enter run admission. */
export interface AgentSessionConversation extends ConversationBase
{
	/** Immutable mode selecting the agent-session command strategy. */
	readonly mode: ConversationModes.AgentSession;
	/** Exactly one agent service bound for the complete lifetime of the conversation. */
	readonly agentServiceId: string;
}

/** Ordinary direct conversation that must not carry an agent-service binding. */
export interface DirectConversation extends ConversationBase
{
	/** Immutable mode selecting the direct-message command strategy. */
	readonly mode: ConversationModes.Direct;
	/** Forbidden agent binding, expressed so object literals fail to compile when one is supplied. */
	readonly agentServiceId?: never;
}

/** Ordinary group conversation that must not carry an agent-service binding. */
export interface GroupConversation extends ConversationBase
{
	/** Immutable mode selecting the group-message command strategy. */
	readonly mode: ConversationModes.Group;
	/** Forbidden agent binding, expressed so object literals fail to compile when one is supplied. */
	readonly agentServiceId?: never;
}

/** Canonical durable conversation with a compile-time exact agent-binding invariant. */
export type Conversation = AgentSessionConversation | DirectConversation | GroupConversation;

/** Participant-specific coordinates that never alter conversation lifecycle or mode. */
export interface ConversationParticipant
{
	/** Conversation whose membership owns these coordinates. */
	readonly conversationId: ConversationId;
	/** User represented by this participant record. */
	readonly userId: string;
	/** First timeline position visible to the participant. */
	readonly visibleFromPosition: string;
	/** Greatest timeline position the participant has durably read, or canonical zero while unread. */
	readonly readThroughPosition: string;
	/** ISO-8601 archive instant, or null while the conversation remains in the user's list. */
	readonly archivedAt: string | null;
	/** Last timeline position visible after access ends, or null while access remains valid. */
	readonly accessEndedPosition: string | null;
}
