import type { ChannelTargetAuthorityRepository } from "@opencrane/backend/server/agents/channel-targets";

import type { ConversationReplayRepository } from "./replay-reader.types.js";

/** Dependencies owned by the server composition root for internal snapshot replay. */
export interface ConversationReplayRouterDependencies
{
	/** One-use channel-context authority. */
	readonly contexts: ChannelTargetAuthorityRepository;
	/** Canonical participant-bound replay reader. */
	readonly repository: ConversationReplayRepository;
	/** Route selected only by server configuration. */
	readonly expectedRouteId: string;
	/** Trusted server clock. */
	readonly nowEpochMs: () => number;
}
