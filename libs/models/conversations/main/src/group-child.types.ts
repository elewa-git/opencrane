/**
 * Describes child creation progress for the participant API and its polling clients.
 * These values represent the persisted ConversationChildRequest state; changing a value changes
 * the API contract and its database mapping. Validators reject unknown states. None reports the
 * assistant's run outcome, and a saved state never grants current access to either conversation.
 */
export enum GroupChildStates
{
	/** Creation is not terminal: its task still owes the child or its first activation. */
	Pending = "pending",
	/** Creation is terminal: the child and first activation are saved; the assistant may still be working. */
	Ready = "ready",
	/** Creation is terminal after lost authority, conflicting creation data, or exhausted retries; this UUID cannot restart it. */
	Unavailable = "unavailable",
}

/** Selects an existing group message and a company assistant for a separate child conversation. */
export interface GroupChildCreateCommand
{
	/** Identifies the submitted parent message whose content starts the child. */
	readonly parentMessageId: string;
	/** Gives the message's stream revision so the server can read and verify it directly. */
	readonly parentMessagePosition: string;
	/** Identifies the company assistant the requester is permitted to invoke. */
	readonly agentServiceId: string;
	/** Keeps retries of the same accepted request from creating another child. */
	readonly idempotencyKey: string;
}

/** Contains the text a person reviewed before sharing it from a child to its immediate parent. */
export interface GroupChildShareCommand
{
	/** Identifies the child entry the person used as the source. */
	readonly sourceEntryId: string;
	/** Gives the source revision for a bounded, verified history read. */
	readonly sourcePosition: string;
	/** Holds the exact reviewed text to post as the sharing person. */
	readonly text: string;
	/** Keeps a retry from posting the reviewed result twice. */
	readonly idempotencyKey: string;
}

/** Returns a child request only after checking the caller's current access. */
export interface GroupChildView
{
	/** Identifies the child conversation to open once creation is ready. */
	readonly conversationId: string;
	/** Identifies the immediate parent group. */
	readonly parentConversationId: string;
	/** Identifies the parent message that requested the work. */
	readonly parentMessageId: string;
	/** Gives the parent message's immutable stream revision. */
	readonly parentMessagePosition: string;
	/** Describes creation progress independently of the assistant's run outcome. */
	readonly state: GroupChildStates;
	/** Captures the selected assistant's display name for this request. */
	readonly agentName: string;
}

/** Preserves a child's origin without granting access to either conversation. */
export interface GroupChildOrigin
{
	/** Identifies the admitted creation request. */
	readonly requestId: string;
	/** Identifies the immediate parent group. */
	readonly parentConversationId: string;
	/** Identifies the parent message that requested the work. */
	readonly parentMessageId: string;
	/** Gives the original message's stream revision for direct verification. */
	readonly parentMessagePosition: string;
}
