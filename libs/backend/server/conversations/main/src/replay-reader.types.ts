import type { ConversationReplayCursor } from "@opencrane/models/conversations";
import type { ConversationReplayEventRow } from "./replay-projection.types.js";

/** Read-only canonical timeline request bound to a consumed invocation context. */
export interface ReadConversationReplayCommand
{
	/** Conversation authority selected by the context. */
	readonly conversationId: string;
	/** Silo authority selected by the context. */
	readonly siloId: string;
	/** Explicit participant selected by the context. */
	readonly subjectId: string;
	/** Resume position, or null for a complete initial snapshot. */
	readonly cursor: ConversationReplayCursor | null;
	/** Server-owned maximum event count. */
	readonly limit: number;
}

/** Read-only transaction boundary exposed to replay transport and projection orchestration. */
export interface ConversationReplayUnitOfWork
{
	/** Returns one participant-authorised event snapshot from a single persistence unit of work. */
	read(command: ReadConversationReplayCommand): Promise<readonly ConversationReplayEventRow[]>;
}

/** Transaction-scoped canonical replay persistence capability. */
export interface ConversationReplayRepository
{
	/** Returns only immutable authorised conversation events after the supplied position. */
	read(command: ReadConversationReplayCommand): Promise<readonly ConversationReplayEventRow[]>;
}
