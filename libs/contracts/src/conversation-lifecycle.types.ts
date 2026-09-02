/**
 * Selects the conversation contract recorded by `ConversationCreated` at stream revision zero.
 *
 * The creation validator accepts this closed set of serialized values before `ConversationHistoryReader`
 * exposes participant entries. It is stored in KurrentDB history, so adding or renaming a member
 * changes the persisted event contract; an unknown value makes the creation event malformed.
 */
export enum ConversationLifecycleModes
{
	/** The conversation has exactly two human participants and no computer at creation. */
	Direct = "direct",
	/** The conversation has multiple human participants and no computer at creation. */
	Group = "group",
	/** The conversation owns the ConversationComputer bound by its creation authority. */
	Agent = "agent",
}

/** Records one initial participant and the visibility boundary that the creation stream establishes. */
export interface ConversationCreatedParticipant
{
	/** Identifies the user whose conversation projection begins at this history position. */
	readonly userId: string;
	/** Records the first history position this participant may read. */
	readonly visibleFromPosition: string;
	/** Records the server time at which the participant joined the new conversation. */
	readonly joinedAt: string;
}

/** Records the immutable service, identity, profile, and computer coordinates for an agent conversation. */
export interface ConversationCreatedAgentBinding
{
	/** Identifies the AgentService selected by the creation authority. */
	readonly agentServiceId: string;
	/** Identifies the published AgentRevision admitted for the new conversation. */
	readonly agentRevisionId: string;
	/** Identifies the resolved AgentIdentity bound to the new computer. */
	readonly agentIdentityId: string;
	/** Identifies the release-owned computer profile selected for that identity. */
	readonly profileRevisionId: string;
	/** Identifies the cold logical computer provisioned for this agent conversation. */
	readonly computerId: string;
}

/**
 * Records the authorization evidence that admitted a conversation before its history stream exists.
 *
 * The creation authority retains these identifiers in the revision-zero event rather than accepting
 * participant content as proof of who created the stream.
 */
export interface ConversationCreationProvenance
{
	/** Names the principal whose current grant admitted the creation command. */
	readonly principalId: string;
	/** Names the durable authorization evidence retained by the creation authority. */
	readonly authorizationEvidenceId: string;
	/** Identifies the browser retry that the creation authority may resume exactly once. */
	readonly requestId: string;
}

/**
 * Records the revision-zero lifecycle event that establishes a conversation history stream.
 *
 * `ConversationHistoryAuthority.create` writes this before any participant entry, and
 * `ConversationHistoryReader` rejects a stream whose first event does not validate. It carries the
 * projection facts needed to rebuild the conversation without reading a relational creator row.
 */
export interface ConversationCreated
{
	/** Names the persisted lifecycle contract shape. */
	readonly schemaVersion: 1;
	/** Identifies the conversation whose history this event anchors. */
	readonly conversationId: string;
	/** Fixes the exact conversation mode that a rebuilt projection must restore. */
	readonly mode: ConversationLifecycleModes;
	/** Records the ordered initial participants and their first readable history positions. */
	readonly participants: readonly ConversationCreatedParticipant[];
	/** Records the computer binding for an agent conversation, or null when no computer is allowed. */
	readonly agentBinding: ConversationCreatedAgentBinding | null;
	/** Records the server instant at which the creation authority admitted this stream. */
	readonly createdAt: string;
	/** Preserves the checked authorization provenance without duplicating participant content. */
	readonly provenance: ConversationCreationProvenance;
}
