import type { ConversationId } from "./identifiers.types.js";

/**
 * What kind of conversation this is. Fixed when the conversation is created and never changed.
 *
 * The mode decides what a submitted message does: in `AgentSession` it starts an agent run, in
 * `Direct` and `Group` it is simply stored. It also decides whether an agent binding is required
 * or forbidden — see {@link __HasValidConversationAgentBinding}. The strings are stored, so a
 * rename breaks existing rows.
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
 * Whether a conversation still accepts writes. It only ever moves from `Open` to `Closed`.
 *
 * Closing is permanent and denies every command. Do not confuse it with a participant archiving
 * the conversation, which is per-participant, reversible, and lives on
 * {@link ConversationParticipant}.
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
	/** Never set. Declared as `never` so supplying an agent service on a direct conversation fails to compile. */
	readonly agentServiceId?: never;
}

/** Ordinary group conversation that must not carry an agent-service binding. */
export interface GroupConversation extends ConversationBase
{
	/** Immutable mode selecting the group-message command strategy. */
	readonly mode: ConversationModes.Group;
	/** Never set. Declared as `never` so supplying an agent service on a direct conversation fails to compile. */
	readonly agentServiceId?: never;
}

/** One stored conversation. The union makes the agent binding a compile-time rule: an agent-session conversation must carry `agentServiceId`, and a direct or group conversation cannot. */
export type Conversation = AgentSessionConversation | DirectConversation | GroupConversation;

/** Body for creating one conversation. `AgentSession` needs an agent service; `Direct` needs exactly one other participant; `Group` needs one to ninety-nine. */
export type ConversationCreationRequest =
	| { readonly mode: ConversationModes.AgentSession; readonly agentServiceId: string; readonly participantUserIds?: never }
	| { readonly mode: ConversationModes.Direct | ConversationModes.Group; readonly participantUserIds: readonly string[]; readonly agentServiceId?: never };

/** One participant's own view of a conversation: where their visibility starts, how far they have read, whether they archived it, and where their access ended. None of it affects the conversation itself or any other participant. */
export interface ConversationParticipant
{
	/** Conversation this participant record belongs to. */
	readonly conversationId: ConversationId;
	/** User represented by this participant record. */
	readonly userId: string;
	/** First timeline position visible to the participant. */
	readonly visibleFromPosition: string;
	/** Highest timeline position this participant has read. `"0"` means they have read nothing. */
	readonly readThroughPosition: string;
	/** ISO-8601 archive instant, or null while the conversation remains in the user's list. */
	readonly archivedAt: string | null;
	/** Last timeline position visible after access ends, or null while access remains valid. */
	readonly accessEndedPosition: string | null;
}
