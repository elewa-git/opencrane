import type { Request } from "express";
import type { Logger } from "@opencrane/backend/observability";

import type { ConversationReplayUnitOfWork } from "./replay-reader.types.js";
import type { ConversationLiveReplayClock, ConversationLiveReplayLimits, ConversationOpenInterruptReader } from "./conversation-live-replay.types.js";

/** Session-derived participant identity for the self-only conversation history surface. */
export interface SelfConversationReplayCaller
{
	/** Canonical silo selected from the trusted request host. */
	readonly siloId: string;
	/** Stable authenticated subject permitted to read their participant conversations. */
	readonly subjectId: string;
}

/** App-composed ports for self-only canonical conversation replay. */
export interface SelfConversationReplayRouterDependencies
{
	/** Resolves authenticated session and host identity without trusting request coordinates. */
	resolveCaller(request: Request): SelfConversationReplayCaller | null;
	/** Reads canonical events only after the router derives owner coordinates. */
	repository: ConversationReplayUnitOfWork;
	/** Current open-approval overlay, kept outside canonical cursor authority. */
	interrupts?: ConversationOpenInterruptReader;
	/** Bounded live-tail clock. */
	clock: ConversationLiveReplayClock;
	/** Bounded page, heartbeat, polling, and response-duration limits. */
	limits: ConversationLiveReplayLimits;
	/** Records unexpected persistence failures without event content. */
	logger: Logger;
}
