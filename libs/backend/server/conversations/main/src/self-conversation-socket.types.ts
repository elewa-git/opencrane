import type { IncomingMessage, Server } from "node:http";

import type { ConversationOpenInterruptReader, ConversationProjectionClock, ConversationProjectionLimits } from "@opencrane/backend/conversations/projection";
import type { Logger } from "pino";

import type { ConversationReplayUnitOfWork } from "./replay-reader.types";
import type { ConversationCaller } from "./types/conversation-caller.types";
import type { ConversationUnitOfWork } from "./types/conversation-unit-of-work.types";

/**
 * Authenticates an HTTP upgrade before the socket server takes ownership of its connection.
 *
 * Implementations derive the participant from server-trusted request facts, rather than a socket
 * query parameter or frame. Returning `null` means the upgrade is refused; returning a caller lets
 * the projection and message authorities apply their usual participant checks.
 *
 * Called by: `__CreateSelfConversationSocketServer` for every selected socket upgrade.
 */
export interface SelfConversationSocketAuthenticator
{
	/** Restores the cookie session and derives the current participant from trusted request facts. */
	authenticate(request: IncomingMessage): Promise<ConversationCaller | null>;
}

/**
 * Connects the configured conversation socket boundary to the app's public HTTP listener.
 *
 * `attach` owns only upgrades for the conversation socket address and destroys other upgrades on
 * that listener. `close` is the lifecycle handoff: it asks each active peer to reconnect before
 * the app drains dependencies such as Prisma.
 *
 * Called by: `_StartProcessLifecycle` in `apps/opencrane/src/app/lifecycle.ts`.
 */
export interface SelfConversationSocketServer
{
	/** Handles conversation upgrades and closes malformed or unrelated public upgrades. */
	attach(server: Server): void;
	/** Ends every active conversation socket during process shutdown. */
	close(): void;
}

/**
 * Supplies the two conversation authorities that one authenticated socket needs.
 *
 * The write authority admits participant commands and the replay authority rereads display-safe
 * timeline rows. Keeping them as separate ports prevents the transport from deciding membership,
 * mode, idempotency, or projection content; it only binds the authenticated caller and socket
 * lifetime to those existing decisions.
 *
 * Called by: `_CreatePrismaSelfConversationSocketServer`, which supplies the production Prisma
 * adapters and process-owned interrupt and shutdown seams.
 */
export interface SelfConversationSocketDependencies
{
	/** Restores an authenticated participant before accepting an upgrade. */
	readonly authenticator: SelfConversationSocketAuthenticator;
	/** Admits participant messages with the same mode and idempotency checks as the HTTP API. */
	readonly authority: ConversationUnitOfWork;
	/** Re-reads authorized timeline rows for the current socket cursor. */
	readonly repository: ConversationReplayUnitOfWork;
	/** Supplies current approval and elicitation overlays when enabled. */
	readonly interrupts?: ConversationOpenInterruptReader;
	/** Controls replay polling and finite connection lifetime. */
	readonly clock: ConversationProjectionClock;
	/** Caps replay pages, heartbeats, and the connection lifetime. */
	readonly limits: ConversationProjectionLimits;
	/** Cancels active streams as the process drains. */
	readonly shutdownSignal?: AbortSignal;
	/** Records unexpected socket failures without message content. */
	readonly logger: Logger;
}
