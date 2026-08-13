import type { Request } from "express";
import type { Logger } from "pino";

import type { ConversationCaller, ConversationUnitOfWork } from "./conversation-authority.types.js";

/**
 * What `__CreateSelfConversationsRouter` needs. Built by
 * `_CreateSelfConversationsRouter` (prisma-self-conversations.router.ts).
 */
export interface SelfConversationsRouterDependencies
{
	/** Works out who is calling from the session and the request host. Null means no session, which the routes answer with 401. */
	readonly resolveCaller: (request: Request) => ConversationCaller | null;
	/** Does the actual work and owns authorisation; the router only translates its results into HTTP. */
	readonly authority: ConversationUnitOfWork;
	/** Used only for unexpected failures and database-unavailable denials. Never receives message content or user identity. */
	readonly logger: Logger;
}
