import type { ChannelTargetAuthorityRepository } from "@opencrane/backend/server/agents/channel-targets";

import type { ConversationReplayUnitOfWork } from "./replay-reader.types.js";

/** Dependencies owned by the server composition root for internal conversation replay. */
export interface ConversationReplayRouterDependencies
{
	/** One-use channel-context authority. */
	readonly contexts: ChannelTargetAuthorityRepository;
	/** Canonical participant-bound replay reader. */
	readonly repository: ConversationReplayUnitOfWork;
	/** Route selected only by server configuration. */
	readonly expectedRouteId: string;
	/** Trusted server clock. */
	readonly nowEpochMs: () => number;
}
