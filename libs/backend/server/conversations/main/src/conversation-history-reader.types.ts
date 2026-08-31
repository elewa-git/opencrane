import type { ConversationEntry } from "@opencrane/contracts";

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
	/** Starts at this inclusive KurrentDB revision, or at the immutable first entry when omitted. */
	readonly fromRevision?: bigint;
}

/** Reports the derived stream coordinate and validated entries returned from it in stream order. */
export interface ConversationHistoryReadResult
{
	/** Names the only KurrentDB stream read for this command. */
	readonly streamName: string;
	/** Lists the participant-visible entries in their validated immutable stream order. */
	readonly entries: readonly ConversationEntry[];
}
