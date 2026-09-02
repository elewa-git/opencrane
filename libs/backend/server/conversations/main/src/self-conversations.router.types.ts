import type { Request } from "express";
import type { Logger } from "pino";

import type { ConversationCaller } from "./types/conversation-caller.types";
import type { ConversationUnitOfWork } from "./types/conversation-unit-of-work.types";
import type { ConversationComputerParticipantInputAdmission } from "./conversation-computers/conversation-computer-participant-input-admission";

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
	/** Admits AgentSession text into immutable history; null rejects it rather than using the message authority. */
	readonly computerInputs: Pick<ConversationComputerParticipantInputAdmission, "admit"> | null;
	/** Used only for unexpected failures and database-unavailable denials. Never receives message content or user identity. */
	readonly logger: Logger;
}
