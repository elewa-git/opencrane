import type { ConversationReplayCursor } from "./replay-cursor.types.js";
import type { ConversationReplayEventRow } from "./replay-projection.types.js";

/** Read-only replay request bound to a consumed invocation context. */
export interface ReadConversationReplayCommand
{
	/** Thread authority selected by the context. */
	readonly threadId: string;
	/** Silo authority selected by the context. */
	readonly siloId: string;
	/** Explicit participant selected by the context. */
	readonly subjectId: string;
	/** Resume position, or null for a complete initial snapshot. */
	readonly cursor: ConversationReplayCursor | null;
	/** Server-owned maximum event count. */
	readonly limit: number;
}

/** Read-only canonical replay persistence port. */
export interface ConversationReplayRepository
{
	/** Returns only immutable authorised thread events after the supplied position. */
	read(command: ReadConversationReplayCommand): Promise<readonly ConversationReplayEventRow[]>;
}
