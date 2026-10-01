import type { HistoryStore } from "@opencrane/backend/server/infra/history-store";
import type { Logger } from "@opencrane/backend/observability";

import type { ConversationCallerResolver, SelfConversationHistoryAuthority } from "./self-conversation-history.types";

/** Bounds browser event traffic in one public-listener process. */
export interface SelfConversationEventLimits
{
	/** Closes a connection even when new entries keep arriving. */
	readonly durationMs: number;
	/** Closes a connection that receives no new history. */
	readonly idleMs: number;
	/** Rechecks current participant authority while a stream is quiet. */
	readonly heartbeatMs: number;
	/** Bounds how long a slow browser can retain a buffered frame. */
	readonly drainMs: number;
	/** Caps one serialized SSE frame. */
	readonly eventBytes: number;
	/** Caps the bytes written by one connection. */
	readonly responseBytes: number;
	/** Caps history frames, including cursor-only frames for hidden entries. */
	readonly eventCount: number;
	/** Caps simultaneous connections for one authenticated silo and subject. */
	readonly subjectConnections: number;
	/** Caps connection attempts by one subject in a minute. */
	readonly subjectStartsPerMinute: number;
	/** Caps open connections across this listener. */
	readonly totalConnections: number;
	/** Caps retained rate-limiter keys, including inactive subjects in the current minute. */
	readonly subjects: number;
}

/** Supplies current product authority and the existing private KurrentDB port to the browser adapter. */
export interface SelfConversationEventsDependencies
{
	/** Rechecks membership, participation, Read permission, and private visibility for each page. */
	readonly authority: Pick<SelfConversationHistoryAuthority, "read">;
	/** Derives the caller from the verified browser session. */
	readonly resolveCaller: ConversationCallerResolver;
	/** Opens only the conversation stream derived after participant authorization succeeds. */
	readonly historyStore: Pick<HistoryStore, "subscribe">;
	/** Ends subscriptions before process dependencies close. */
	readonly shutdownSignal: AbortSignal;
	/** Records one safe diagnostic when upstream history or integrity checks end a connection. */
	readonly logger: Pick<Logger, "warn">;
	/** Allows composition and deterministic tests to choose bounded connection budgets. */
	readonly limits?: Partial<SelfConversationEventLimits>;
}

/** Tracks one subject's active streams and one-minute connection budget. */
export interface ConversationEventSubjectBudget
{
	/** Counts currently open streams. */
	active: number;
	/** Counts admitted starts in the current minute. */
	starts: number;
	/** Records when the current rate window began. */
	windowStartedAt: number;
}
