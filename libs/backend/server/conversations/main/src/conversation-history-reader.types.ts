import type { ConversationEntry } from "@opencrane/contracts";
import type { HistoryExpectedRevisions } from "@opencrane/backend/server/infra/history-store";

/**
 * Identifies the immutable creation record that a history-backed projection may read.
 *
 * The projection supplies server-derived coordinates and receives the validated revision-zero
 * record. It cannot select a later range because every conversation projection starts from its
 * creation anchor.
 */
export interface ConversationCreationReadCommand
{
	/** Names the silo whose envelope metadata must own the creation record. */
	readonly siloId: string;
	/** Names the sole conversation stream whose revision-zero record may be read. */
	readonly conversationId: string;
}

/**
 * Identifies a finite read that an authorized conversation transport may make from a KurrentDB stream.
 *
 * The transport supplies server-derived coordinates after it checks current PostgreSQL membership
 * and visibility. ConversationHistoryReader derives the physical stream name and does not receive
 * PostgreSQL authorization, browser, or cursor state.
 */
export interface ConversationHistoryReadCommand
{
	/** Names the silo whose envelope metadata must own every returned event. */
	readonly siloId: string;
	/** Names the sole conversation stream that may be read. */
	readonly conversationId: string;
	/** Selects the inclusive stream revision of participant entries to return after the lifecycle anchor validates. */
	readonly fromRevision?: bigint;
}

/**
 * Reports the derived stream, the head observed during validation, and its participant entries.
 *
 * Revision zero is a lifecycle event rather than a participant entry, so `entries` can be empty
 * even when `revision` is zero.
 */
export interface ConversationHistoryReadResult
{
	/** Names the only KurrentDB stream read for this command. */
	readonly streamName: string;
	/** Reports the final revision observed while the reader validated the complete lifecycle-anchored stream. */
	readonly revision: bigint | null;
	/** Lists the participant-visible entries in their validated immutable stream order; revision zero is never an entry. */
	readonly entries: readonly ConversationEntry[];
}

/**
 * Carries a fully replayed participant transcript and the checked head for a later atomic append.
 *
 * A ConversationComputer command uses this result after it has checked the whole transcript, then
 * includes {@link expectedRevision} in its append. The result does not authorize a participant or
 * grant permission to write; it prevents that later authorization from acting on a transcript that
 * has changed since the replay.
 */
export interface CurrentConversationHistory extends ConversationHistoryReadResult
{
	/** Reports the KurrentDB head that a later atomic append must compare before it writes. */
	readonly expectedRevision: HistoryExpectedRevisions.NoStream | bigint;
}
