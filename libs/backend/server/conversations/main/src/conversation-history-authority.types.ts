import type { ConversationCreated, ConversationEntry } from "@opencrane/contracts";
import { type HistoryAppendReceipt, type HistoryExpectedRevisions } from "@opencrane/backend/server/infra/history-store";

/**
 * Describes what happened when KurrentDB checked a participant-visible entry against a conversation stream head.
 *
 * The admission boundary branches on these closed results: a receipt proves the append committed, while a
 * conflict requires the caller to read the new head and authorize again. ADR 0016 requires stale writers to
 * reload and be denied rather than write through a second history authority.
 */
export enum ConversationHistoryAppendOutcomes
{
	/** KurrentDB committed the entry, so the receipt identifies the stream revision the caller may expose. */
	Appended = "appended",
	/** Another writer advanced this stream first, so the caller must re-authorize before it attempts another append. */
	ExpectedHeadConflict = "expected_head_conflict",
}

/**
 * Carries an entry that a server-side admission boundary has already authorized for one conversation stream.
 *
 * The authority validates every coordinate before it builds a KurrentDB envelope, because the HistoryStore port
 * does not decide membership or grant access. ADR 0016 keeps that decision in PostgreSQL and keeps the stream
 * immutable participant history.
 */
export interface ConversationHistoryAppendCommand
{
	/** Names the silo that owns the conversation and is recorded in the KurrentDB event envelope. */
	readonly siloId: string;
	/** Names the one conversation whose stream receives the entry. */
	readonly conversationId: string;
	/** Requires the stream revision the server observed while it authorized and stamped the entry. */
	readonly expectedRevision: HistoryExpectedRevisions.NoStream | bigint;
	/** Carries the complete server-stamped participant-visible entry. */
	readonly entry: ConversationEntry;
}

/**
 * Carries the server-authorized revision-zero record that creates a conversation stream.
 *
 * The caller supplies an idempotency event UUID and creation evidence after authorization; this
 * command cannot carry a participant entry, so the first participant entry must use revision one.
 */
export interface ConversationHistoryCreateCommand
{
	/** Names the silo that owns the new conversation and its immutable history envelope. */
	readonly siloId: string;
	/** Supplies the UUID event identifier that makes a response-lost creation retry byte-stable. */
	readonly eventId: string;
	/** Carries the immutable creation anchor before any participant-visible entry may exist. */
	readonly created: ConversationCreated;
}

/** Reports a committed receipt or the conflict that requires the caller to authorize against the new stream head. */
export type ConversationHistoryAppendResult =
	| {
		/** States that KurrentDB committed the entry at the checked stream head. */
		readonly outcome: ConversationHistoryAppendOutcomes.Appended;
		/** Reports the exact stream and committed revision returned by HistoryStore. */
		readonly receipt: HistoryAppendReceipt;
	}
	| {
		/** States that the expected conversation stream head was stale before KurrentDB accepted the append. */
		readonly outcome: ConversationHistoryAppendOutcomes.ExpectedHeadConflict;
	};
