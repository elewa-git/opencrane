import type { Request } from "express";
import type { Logger } from "pino";

import type { ConversationCaller, ConversationUnitOfWork } from "./conversation-authority.types.js";

/** Dependencies for the authenticated participant-owned conversation API. */
export interface SelfConversationsRouterDependencies
{
	readonly resolveCaller: (request: Request) => ConversationCaller | null;
	readonly authority: ConversationUnitOfWork;
	readonly logger: Logger;
}
