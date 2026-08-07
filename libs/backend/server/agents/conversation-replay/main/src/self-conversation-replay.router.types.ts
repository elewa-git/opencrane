import type { Request } from "express";
import type { Logger } from "@opencrane/backend/observability";

import type { ConversationReplayRepository } from "./replay-reader.types.js";

/** Session-derived owner identity for the self-only conversation history surface. */
export interface SelfConversationReplayCaller
{
	/** Canonical silo selected from the trusted request host. */
	readonly siloId: string;
	/** Stable authenticated subject permitted to read their participant threads. */
	readonly subjectId: string;
}

/** App-composed ports for self-only canonical conversation replay. */
export interface SelfConversationReplayRouterDependencies
{
	/** Resolves authenticated session and host identity without trusting request coordinates. */
	resolveCaller(request: Request): SelfConversationReplayCaller | null;
	/** Reads canonical events only after the router derives owner coordinates. */
	repository: ConversationReplayRepository;
	/** Records unexpected persistence failures without event content. */
	logger: Logger;
}
