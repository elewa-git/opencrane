import type { HistoryAppendReceipt } from "@opencrane/backend/server/infra/history-store";

/**
 * Carries the caller-safe facts for one ordinary runtime-input request.
 *
 * The authority derives the identity, active execution, lease, participant, deadline, author, and
 * physical stream from these coordinates. `requestId` returns the first durable winner only when
 * every request fact remains identical; changed reuse fails closed.
 *
 * Called by: no production composition yet; the #759 ConversationComputer loop checkpoint will own it.
 * @see ConversationComputerRuntimeInputElicitationAuthority
 */
export interface ConversationComputerRuntimeInputElicitationCommand
{
	/** Names the silo whose active ConversationComputer may request input. */
	readonly siloId: string;
	/** Names the sole ConversationComputer that owns this request. */
	readonly computerId: string;
	/** Names the participant history stream that receives the request. */
	readonly conversationId: string;
	/** Names the immutable profile revision admitted for the active computer. */
	readonly profileRevisionId: string;
	/** Supplies the UUID idempotency key and KurrentDB event identifier for this request. */
	readonly requestId: string;
	/** Names the elicitation lifecycle that this entry starts. */
	readonly elicitationId: string;
	/** Points to the protected input payload without embedding it in conversation history. */
	readonly requestPayloadRef: string;
	/** Binds the caller-supplied protected input payload digest after validating its SHA-256 form. */
	readonly requestPayloadDigest: `sha256:${string}`;
	/** Names the direct event or workflow cause recorded with the entry. */
	readonly causationId: string;
	/** Names the workflow correlation shared by related entries. */
	readonly correlationId: string;
}

/**
 * Resolves an active addressed participant from trusted server-side participation state.
 *
 * The runtime never selects a participant, so this port converts the checked computer identity
 * into the sole addressable participant before the authority records a request.
 *
 * Called by: ConversationComputerRuntimeInputElicitationAuthority.
 */
export interface ConversationComputerRuntimeInputParticipantResolver
{
	/** Resolves the one active participant the derived runtime identity may address. */
	resolve(command: { readonly siloId: string; readonly conversationId: string; readonly computerId: string; readonly agentIdentityId: string }): Promise<{ readonly participantId: string }>;
}

/**
 * Owns the current clock used for deadline and authorization checks.
 *
 * Called by: ConversationComputerRuntimeInputElicitationAuthority.
 */
export interface ConversationComputerRuntimeInputClock
{
	/** Returns the server time used for authorization and the server-owned request deadline. */
	now(): Date;
}

/**
 * Returns the receipt for a newly appended RuntimeInput request or an exact durable retry winner.
 *
 * A changed request that reuses an existing id fails closed instead of returning this result.
 *
 * Called by: ConversationComputerRuntimeInputElicitationAuthority.
 */
export interface ConversationComputerRuntimeInputElicitationResult
{
	/** Identifies the persisted request, including the original winner when a retry replays it. */
	readonly receipt: HistoryAppendReceipt;
}
