import type { Request } from "express";
import type { Logger } from "@opencrane/backend/observability";
import type { ConversationOpenInterruptReader, ConversationProjectionClock, ConversationProjectionLimits } from "@opencrane/backend/conversations/projection";

import type { ConversationReplayUnitOfWork } from "./replay-reader.types";

/** Session-derived participant identity for the self-only conversation history surface. */
export interface SelfConversationReplayCaller
{
	/** Canonical silo selected from the trusted request host. */
	readonly siloId: string;
	/** Stable authenticated subject permitted to read their participant conversations. */
	readonly subjectId: string;
}

/**
 * The two things only the running process can supply, both optional so tests and simple setups
 * can leave them out.
 *
 * Called by: `_CreateSelfConversationReplayRouter`
 * (prisma-self-conversation-replay.router.ts); both values are passed in from
 * apps/opencrane/src/app/routes.ts.
 */
export interface SelfConversationReplayCompositionOptions
{
	/** Reader for approvals currently awaiting the user. Its events carry no cursor, so they never move the client's resume point. Omit it and the stream carries stored events only. */
	readonly interrupts?: ConversationOpenInterruptReader;
	/** Aborts on shutdown so open streams close before the process exits, rather than being cut off mid-frame with traces and logs still unflushed. */
	readonly shutdownSignal?: AbortSignal;
}

/** App-composed ports for self-only canonical conversation replay. */
export interface SelfConversationReplayRouterDependencies
{
	/** Works out who is calling from the session cookie and the request host. Returns null when there is no session, which the route answers with 401. Nothing here comes from the path, query, or body. */
	resolveCaller(request: Request): SelfConversationReplayCaller | null;
	/** Reads canonical events only after the router derives owner coordinates. */
	repository: ConversationReplayUnitOfWork;
	/** Reader for approvals currently awaiting the user. Its events carry no cursor, so they never move the client's resume point. Omit it and the stream carries stored events only. */
	interrupts?: ConversationOpenInterruptReader;
	/** Bounded live-tail clock. */
	clock: ConversationProjectionClock;
	/** Bounded page, heartbeat, polling, and response-duration limits. */
	limits: ConversationProjectionLimits;
	/** Aborts on shutdown so open streams close before the process exits, rather than being cut off mid-frame with traces and logs still unflushed. */
	shutdownSignal?: AbortSignal;
	/** Records unexpected persistence failures without event content. */
	logger: Logger;
}
