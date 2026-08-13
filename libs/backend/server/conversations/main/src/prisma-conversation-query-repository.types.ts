import type { ConversationLifecycles, ConversationModes } from "@opencrane/models/conversations";

import type { AgentThreadSnapshotView } from "./types/agent-thread-view.types.js";
import type { ConversationCaller } from "./types/conversation-caller.types.js";
import type { ConversationCreationDirectory } from "./types/conversation-directory.types.js";
import type { ConversationDetail, ConversationMessageView, ConversationSummary } from "./types/conversation-view.types.js";

/**
 * The four stored facts the command decision needs, and nothing else.
 *
 * It is deliberately this small: `__DecideConversationCommand` in
 * `@opencrane/models/conversations` is a pure function of these values, so the same inputs
 * always give the same decision and the rule can be tested without a database. Widening this
 * type quietly gives that rule more to depend on.
 */
export interface ConversationCommandContext
{
	/** Agent session, direct, or group. Fixed at creation, and it decides which commands exist at all. */
	readonly mode: ConversationModes;
	/** Open or closed. Closed refuses every write, permanently. */
	readonly lifecycle: ConversationLifecycles;
	/** The agent behind an agent-session conversation; null for direct and group. */
	readonly agentServiceId: string | null;
	/** The run currently in progress, or null. Non-null blocks both a new run and a close. */
	readonly activeRunId: string | null;
}

/**
 * Every read the conversation authority performs, running inside a transaction the caller
 * already opened.
 *
 * Implementations must never open or commit a transaction — that belongs to
 * `PrismaConversationUnitOfWork`, which opens a repeatable-read transaction and then calls
 * these. Reading several of these in one transaction is how a decision is made against a
 * consistent picture instead of a moving one.
 *
 * Every method filters by the caller's participant row, so there is no way to read another
 * user's conversation through this port.
 *
 * Called by: `PrismaConversationUnitOfWork` (prisma-conversation-unit-of-work.ts) via its
 * private `_read` helper. Implemented by `PrismaConversationQueryRepository`.
 */
export interface ConversationQueryRepository
{
	/**
	 * Lists what the caller may start a conversation with: the active members of their organisation
	 * as opaque references, and their own personal Agent.
	 *
	 * @returns The references creation will accept, plus a personal-Agent status. `Ready` carries the
	 *   Agent; `Unavailable` and `Ambiguous` carry none, and a client must then offer direct and group
	 *   conversations only — trying to create an Agent session will be denied.
	 * @throws Error when the caller has no active membership in the silo. Unlike the other methods
	 *   here, this one does not answer with an empty result: there is no such thing as an empty
	 *   directory for a legitimate caller, since they are always in it themselves.
	 * @see PersonalAgentDirectoryStatuses for what each status obliges the caller to do.
	 */
	directory(caller: ConversationCaller): Promise<ConversationCreationDirectory>;
	/**
	 * @returns True while the caller still has an active organisation membership in their silo.
	 *   Re-checked on every write path, so a removed user cannot keep writing on an old session.
	 */
	hasActiveCallerMembership(caller: ConversationCaller): Promise<boolean>;
	/**
	 * @param includeArchived - When false, the caller's own archived conversations are left out.
	 * @returns The caller's conversations; empty is a normal answer.
	 */
	list(caller: ConversationCaller, includeArchived: boolean): Promise<readonly ConversationSummary[]>;
	/**
	 * @returns The conversation with the most recent 100 messages inside the caller's visible
	 *   range, or null when this caller may not see it — missing, foreign silo, and removed are
	 *   deliberately not distinguished.
	 */
	open(caller: ConversationCaller, conversationId: string): Promise<ConversationDetail | null>;
	/** Opens one bounded child snapshot through exact current parent and child access. */
	openAgentThread(caller: ConversationCaller, parentConversationId: string, childConversationId: string): Promise<AgentThreadSnapshotView | null>;
	/**
	 * @returns The four facts needed to decide whether a command is allowed, or null when the
	 *   caller may not see this conversation.
	 */
	loadCommandContext(caller: ConversationCaller, conversationId: string): Promise<ConversationCommandContext | null>;
	/**
	 * Finds a previous message THIS caller sent under this retry key.
	 *
	 * @returns The caller's own earlier message, or null. Restricted to the caller's own
	 *   messages on purpose: on a key collision the answer must never be another participant's
	 *   message, which is why {@link ConversationQueryRepository.hasMessageIdempotencyKey}
	 *   exists as a separate question.
	 */
	findOwnMessage(caller: ConversationCaller, conversationId: string, idempotencyKey: string): Promise<ConversationMessageView | null>;
	/**
	 * @returns True when the key is already used in this conversation by ANYONE. Used only to
	 *   turn a unique-key collision into a conflict denial, never to return the other message.
	 */
	hasMessageIdempotencyKey(caller: ConversationCaller, conversationId: string, idempotencyKey: string): Promise<boolean>;
}
