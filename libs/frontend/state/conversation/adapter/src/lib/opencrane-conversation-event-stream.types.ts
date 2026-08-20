/**
 * Carries the one participant command the selected conversation socket accepts.
 *
 * The browser owns the retry key and display-safe blocks, while the socket URL selects the
 * conversation and the server derives the participant from its session. The adapter sends this
 * only through a live socket for the same conversation and waits for a correlated acknowledgement.
 *
 * Called by: `OpenCraneConversationWorkspaceGateway.send`.
 */
export interface ConversationSocketMessageCommand
{
	/** Conversation selected by the active socket. */
	readonly conversationId: string;
	/** Retry key the server uses to deduplicate uncertain sends. */
	readonly idempotencyKey: string;
	/** Display-safe message blocks in participant-selected order. */
	readonly blocks: readonly { readonly id: string; readonly kind: string; readonly value: string }[];
}
