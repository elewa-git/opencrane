/** Lists the immutable conversation modes that its creation record fixes before any participant entry exists. */
export enum ConversationLifecycleModes
{
	/** The conversation has exactly one human participant and one agent participant. */
	Agent = "agent",
	/** The conversation has human participants without a provisioned agent computer. */
	Group = "group",
}

/** Describes the server-verified principal that authorized one conversation's creation. */
export interface ConversationCreationProvenance
{
	/** Names the principal whose current grant admitted the creation command. */
	readonly principalId: string;
	/** Names the durable authorization evidence retained by the creation authority. */
	readonly authorizationEvidenceId: string;
}

/** Records the immutable first event in every canonical conversation history stream. */
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
