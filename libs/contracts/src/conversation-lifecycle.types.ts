/**
 * Selects the conversation contract recorded by `ConversationCreated` at stream revision zero.
 *
 * The creation validator accepts this closed set of serialized values before `ConversationHistoryReader`
 * exposes participant entries. It is stored in KurrentDB history, so adding or renaming a member
 * changes the persisted event contract; an unknown value makes the creation event malformed.
 */
export enum ConversationLifecycleModes
{
	/** The conversation has exactly one human participant and one agent participant. */
	Agent = "agent",
	/** The conversation has human participants without a provisioned agent computer. */
	Group = "group",
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
}

/**
 * Records the revision-zero lifecycle event that establishes a conversation history stream.
 *
 * `ConversationHistoryAuthority.create` writes this before any participant entry, and
 * `ConversationHistoryReader` rejects a stream whose first event does not validate. The event holds
 * identifiers and authorization evidence, not participant-visible content.
 */
export interface ConversationCreated
{
	/** Names the persisted lifecycle contract shape. */
	readonly schemaVersion: 1;
	/** Identifies the conversation whose history this event anchors. */
	readonly conversationId: string;
	/** Fixes whether the conversation may own a ConversationComputer. */
	readonly mode: ConversationLifecycleModes;
	/** Records the server instant at which the creation authority admitted this stream. */
	readonly createdAt: string;
	/** Preserves the checked authorization provenance without duplicating participant content. */
	readonly provenance: ConversationCreationProvenance;
}
