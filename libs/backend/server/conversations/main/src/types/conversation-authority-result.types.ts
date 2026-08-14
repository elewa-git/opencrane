import type { StartNextRunAttemptResult } from "@opencrane/backend/agents/execution/runs";
import type { AgentThreadOrigin } from "@opencrane/backend/conversations/agent-threads";

import type { ConversationDetail, ConversationMessageView } from "./conversation-view.types.js";

/**
 * Why a conversation write was refused. These string values ARE the API contract: the router
 * sends the member value straight back as the `error` field, so renaming a value is a breaking
 * change for every client.
 *
 * Two rules govern the whole set:
 *
 * 1. Refusals are deliberately vague about other people's data. A conversation that does not
 *    exist, a conversation in another silo, and a conversation the caller was removed from all
 *    return `ConversationUnavailable`. Do not try to tell those apart, and do not add a reason
 *    that would — the shared value is what stops a client from probing for conversations it is
 *    not in.
 * 2. Anything unexpected becomes `PersistenceUnavailable` rather than a success. Nothing here
 *    means "probably worked".
 *
 * Each member maps to exactly one HTTP status in `_STATUS_BY_DENIAL`
 * (self-conversations.router.ts), so the retry advice below is what the status already implies.
 *
 * @see {@link ConversationAuthorityOutcomes} for the success side of the same results.
 */
export enum ConversationWriteDenialReasons
{
	/**
	 * Sent as 404. The conversation is not there for this caller — it may never have existed,
	 * may belong to another silo, or the caller may have lost their organisation membership.
	 * Callers must treat all three the same: drop the conversation from the UI. Retrying will
	 * not help.
	 */
	ConversationUnavailable = "conversation_unavailable",
	/**
	 * Sent as 409. The conversation is closed, and closing is one-way — no write will ever be
	 * accepted again. Stop retrying and disable the composer.
	 */
	ConversationClosed = "conversation_closed",
	/**
	 * Sent as 409. The command does not exist for this conversation's mode — for example asking
	 * an agent session to accept a plain group message. Since mode is fixed at creation, this
	 * is a client bug, not a timing problem; retrying never succeeds.
	 */
	CommandNotSupported = "command_not_supported",
	/**
	 * Sent as 409. An agent run for this conversation is still going, and only one may run at a
	 * time. This one clears by itself: wait for the run to finish (the replay stream reports it)
	 * and send again.
	 */
	ActiveRun = "active_run",
	/**
	 * Sent as 409. This `idempotencyKey` was already used in this conversation with different
	 * content. The stored message is NOT returned, because it may be another participant's.
	 * Generate a fresh key for genuinely new content; reuse a key only for a byte-identical
	 * retry, which returns {@link ConversationAuthorityOutcomes.Idempotent} instead.
	 */
	IdempotencyConflict = "idempotency_conflict",
	/**
	 * Sent as 404, only from create. At least one opaque reference in `participantRefs` no longer
	 * resolves to active membership in this silo. Which one is not disclosed. Re-pick participants from a
	 * fresh directory read.
	 */
	ParticipantUnavailable = "participant_unavailable",
	/**
	 * Sent as 404. The agent service asked for cannot start a run — missing, retired, or with
	 * no usable revision or persona. Offer the user a different agent; retrying the same one
	 * will keep failing until an operator fixes it.
	 */
	AgentServiceUnavailable = "agent_service_unavailable",
	/**
	 * Sent as 429. The platform is at its concurrent-admission limit. Nothing is wrong with the
	 * request — back off and send the same body with the same `idempotencyKey` again.
	 */
	CapacityLimited = "capacity_limited",
	/**
	 * Sent as 503. The database refused or a write could not be confirmed. Whether it landed is
	 * unknown, so retry with the SAME `idempotencyKey`: if it did land the retry comes back as
	 * {@link ConversationAuthorityOutcomes.Idempotent}.
	 */
	PersistenceUnavailable = "persistence_unavailable",
}

/**
 * Alias used in the result unions below, so a denial is always one of
 * {@link ConversationWriteDenialReasons} and never a free-text string. Kept as its own name
 * because the internal callers (run admission, the mutation repository) map their own refusal
 * reasons onto this type before it reaches the wire — see `_runAdmissionDenial` in
 * prisma-conversation-unit-of-work.ts.
 */
export type ConversationWriteDenial = ConversationWriteDenialReasons;

/**
 * How a conversation write ended. Read this field first — it decides which other fields the
 * result object even has. `Denied` carries a `reason`; every other member carries the written
 * row instead.
 *
 * Only `Accepted` and `Idempotent` share a result type, and the difference matters:
 * `Accepted` means this call performed the write (the router answers 201), `Idempotent` means
 * an earlier identical call already did and this one changed nothing (200). A client that
 * treats them alike will double-count sends; a client that treats `Idempotent` as a failure
 * will show a duplicate-send error for a successful message.
 *
 * These string values go out on the wire in the `outcome` field, so they are part of the API
 * contract.
 *
 * @see {@link ConversationWriteDenialReasons} for what `Denied` can say.
 */
export enum ConversationAuthorityOutcomes
{
	/** Returned by create only: the conversation now exists, and the result carries its detail. */
	Created = "created",
	/** Returned by any write: nothing changed, and the result carries a denial reason instead of a row. */
	Denied = "denied",
	/** Returned by submitMessage: this call stored the message. The router answers 201. */
	Accepted = "accepted",
	/**
	 * Returned by submitMessage: this `idempotencyKey` and this exact body were already stored,
	 * so nothing new was written and the existing message is returned. The router answers 200.
	 * Not an error.
	 */
	Idempotent = "idempotent",
	/** Returned by setArchived and close: the conversation was updated, and its fresh detail is returned. */
	Changed = "changed",
}

/**
 * What {@link ConversationUnitOfWork.create} returns. Branch on `outcome`: `Created` gives you
 * the new conversation including its (initially empty) history; `Denied` gives a reason and no
 * conversation was written.
 *
 * @see {@link ConversationWriteDenialReasons.ParticipantUnavailable} and
 * {@link ConversationWriteDenialReasons.AgentServiceUnavailable}, the two denials only create
 * can produce.
 */
export type CreateConversationResult = { readonly outcome: ConversationAuthorityOutcomes.Created; readonly conversation: ConversationDetail } | { readonly outcome: ConversationAuthorityOutcomes.Denied; readonly reason: ConversationWriteDenial };

/**
 * What {@link ConversationUnitOfWork.submitMessage} returns. `Accepted` and `Idempotent` both
 * carry the stored message, so read `outcome` to know whether this call actually wrote
 * anything; `Denied` carries a reason and no message.
 *
 * For an agent-session conversation an `Accepted` result also means a run was started in the
 * same database transaction, so the message and the run can never exist without each other.
 */
export type SubmitConversationMessageResult = { readonly outcome: ConversationAuthorityOutcomes.Accepted | ConversationAuthorityOutcomes.Idempotent; readonly message: ConversationMessageView; readonly agentThread: AgentThreadOrigin | null } | { readonly outcome: ConversationAuthorityOutcomes.Denied; readonly reason: ConversationWriteDenial };

/**
 * What {@link ConversationUnitOfWork.setArchived} and {@link ConversationUnitOfWork.close}
 * return. `Changed` carries the conversation as it now stands, so a caller can render straight
 * from it without a follow-up read; `Denied` carries a reason and nothing was changed.
 */
export type MutateConversationResult = { readonly outcome: ConversationAuthorityOutcomes.Changed; readonly conversation: ConversationDetail } | { readonly outcome: ConversationAuthorityOutcomes.Denied; readonly reason: ConversationWriteDenial };

/** Stable non-disclosing denials for one participant's Agent-thread read coordinate. */
export enum AgentThreadReadDenialReasons
{
	ConversationUnavailable = "conversation_unavailable",
	ObservedPositionUnavailable = "observed_position_unavailable",
}

/** Result of monotonically advancing one participant's Agent-thread read coordinate. */
export type MarkAgentThreadReadResult =
	| { readonly outcome: ConversationAuthorityOutcomes.Changed | ConversationAuthorityOutcomes.Idempotent; readonly readThroughPosition: string }
	| { readonly outcome: ConversationAuthorityOutcomes.Denied; readonly reason: AgentThreadReadDenialReasons };

/** Result returned by the run-owned retry authority after participant authorization. */
export type RetryConversationRunResult = StartNextRunAttemptResult;
