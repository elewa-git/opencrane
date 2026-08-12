import type { Request } from "express";
import type { Logger } from "@opencrane/backend/observability";
import type { ConversationOpenInterruptReader, ConversationProjectionClock, ConversationProjectionLimits } from "@opencrane/backend/conversations/projection";

import type { ConversationReplayUnitOfWork } from "./replay-reader.types.js";

/** Session-derived participant identity for the self-only conversation history surface. */
export interface SelfConversationReplayCaller
{
	/** Canonical silo selected from the trusted request host. */
	readonly siloId: string;
	/** Stable authenticated subject permitted to read their participant conversations. */
	readonly subjectId: string;
}

/** Optional process-owned seams supplied by the app composition root. */
export interface SelfConversationReplayCompositionOptions
{
	/** Current open-approval overlay, kept outside canonical cursor authority. */
	readonly interrupts?: ConversationOpenInterruptReader;
	/** Process shutdown signal that drains long-lived streams before telemetry flush. */
	readonly shutdownSignal?: AbortSignal;
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
	clock: ConversationProjectionClock;
	/** Bounded page, heartbeat, polling, and response-duration limits. */
	limits: ConversationProjectionLimits;
	/** Process shutdown signal that drains long-lived streams before telemetry flush. */
	shutdownSignal?: AbortSignal;
	/** Records unexpected persistence failures without event content. */
	logger: Logger;
}
