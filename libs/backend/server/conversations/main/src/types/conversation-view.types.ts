import { ConversationLifecycles, ConversationModes, MessageRoles, MessageSources, MessageStates, type MessageContentBlock } from "@opencrane/models/conversations";
import type { AgentThreadOrigin } from "@opencrane/backend/conversations/agent-threads";

/**
 * One row in the caller's own conversation list.
 *
 * `archivedAt` and `readThroughPosition` are per-participant: archiving hides the
 * conversation for this user only and does not close it for anyone else. `lifecycle` is the
 * opposite — it is shared, and once it reads closed it never reopens.
 *
 * @see {@link ConversationDetail}, which adds the message history and the caller's visible
 * range.
 */
export interface ConversationSummary
{
	readonly id: string;
	readonly mode: ConversationModes;
	readonly lifecycle: ConversationLifecycles;
	readonly agentServiceId: string | null;
	/** Opaque organisation membership references, never login subjects. */
	readonly participantRefs: readonly string[];
	readonly archivedAt: string | null;
	readonly readThroughPosition: string;
	readonly updatedAt: string;
}

/**
 * One stored message the caller is allowed to see.
 *
 * `position` is the shared timeline number as a decimal string (it is a 64-bit value in the
 * database, so it is not sent as a JSON number). Sort by it to get the true order — do not
 * sort by `createdAt`, which can tie. `runId` is set only when an agent run produced or
 * answered this message; `participantRef` is set only for human-authored messages and cannot be
 * used as a login identifier.
 */
export interface ConversationMessageView
{
	readonly id: string;
	readonly position: string;
	readonly role: MessageRoles;
	readonly state: MessageStates;
	readonly source: MessageSources;
	readonly blocks: readonly MessageContentBlock[];
	readonly runId: string | null;
	/** Opaque author membership reference, or null for a non-human message. */
	readonly participantRef: string | null;
	readonly createdAt: string;
	readonly completedAt: string | null;
	/** Immutable child origin when this ordinary group message invoked an Agent. */
	readonly agentThread: AgentThreadOrigin | null;
}

/**
 * A single conversation plus the slice of its history this caller may read.
 *
 * `visibleFromPosition` is where the caller's access starts, and `accessEndedPosition` is
 * where it stopped (null while they are still a participant). A user added to a group part
 * way through therefore does not receive the earlier messages, and one removed later does not
 * receive the newer ones. `messages` is capped at the most recent 100 rows inside that range,
 * so it is not the whole conversation — stream the replay endpoint for everything.
 *
 * @see {@link ConversationUnitOfWork.open}
 */
export interface ConversationDetail extends ConversationSummary
{
	readonly visibleFromPosition: string;
	readonly accessEndedPosition: string | null;
	readonly messages: readonly ConversationMessageView[];
}
