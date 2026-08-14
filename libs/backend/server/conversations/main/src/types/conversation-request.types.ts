import { ConversationModes, type MessageContentBlock } from "@opencrane/models/conversations";
import type { AgentThreadTarget } from "@opencrane/backend/conversations/agent-threads";

/**
 * Body accepted by {@link ConversationUnitOfWork.create}, already checked against the request
 * schema owned by `@opencrane/models/conversations`.
 *
 * The `mode` picked here (agent session, direct, or group) is fixed for the life of the
 * conversation — there is no API that changes it later, which is why the shape differs per
 * mode: an agent session names one `agentServiceId`, direct and group name participants.
 * Re-exported unchanged from the model package so the HTTP layer and the database layer
 * cannot drift apart.
 */
export type CreateConversationRequest =
	| { readonly mode: ConversationModes.AgentSession; readonly personalAgentRef: string; readonly participantRefs?: never }
	| { readonly mode: ConversationModes.Direct | ConversationModes.Group; readonly participantRefs: readonly string[]; readonly personalAgentRef?: never };

/**
 * One message a user is trying to post, after the router's size and shape checks passed.
 *
 * The blocks have already been limited (at most 32 blocks, 32000 characters each, by
 * `___ParticipantInputBlocksSchema`) so nothing downstream has to defend against an
 * unbounded body.
 *
 * @see {@link ConversationUnitOfWork.submitMessage} for what happens to it.
 */
export interface SubmitConversationMessageRequest
{
	/**
	 * Client-chosen retry key, unique per conversation. Resending the SAME key with the SAME
	 * blocks returns the stored message and outcome `idempotent`; resending it with DIFFERENT
	 * blocks is refused with {@link ConversationWriteDenialReasons.IdempotencyConflict}. The
	 * comparison is a digest of the blocks, so a client must reuse a key only for a true retry.
	 */
	readonly idempotencyKey: string;
	/** The message content, in display order. At least one block; order is preserved exactly as sent. */
	readonly blocks: readonly MessageContentBlock[];
	/** Exact structured target; accepted only for a root message in a group conversation. */
	readonly agentTarget?: AgentThreadTarget;
}

/** Browser request for one fresh attempt of a failed or cancelled run. */
export interface RetryConversationRunRequest
{
	/** Terminal attempt number the participant observed. */
	readonly expectedAttempt: number;
	/** Fresh retry key. Repeating the same key is idempotent; a different key cannot claim its attempt. */
	readonly idempotencyKey: string;
}
