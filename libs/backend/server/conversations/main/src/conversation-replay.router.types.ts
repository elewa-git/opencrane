import type { ChannelTargetAuthorityRepository } from "@opencrane/backend/server/agents/channel-targets";

import type { ConversationReplayUnitOfWork } from "./replay-reader.types.js";
import type { ConversationLiveReplayClock, ConversationLiveReplayLimits } from "./conversation-live-replay.types.js";

/** Dependencies owned by the server composition root for internal conversation replay. */
export interface ConversationReplayRouterDependencies
{
	/** One-use channel-context authority. */
	readonly contexts: ChannelTargetAuthorityRepository;
	/** Canonical participant-bound replay reader. */
	readonly repository: ConversationReplayUnitOfWork;
	readonly clock: ConversationLiveReplayClock;
	readonly limits: ConversationLiveReplayLimits;
	/** Process shutdown signal that drains the stream before telemetry flush. */
	readonly shutdownSignal?: AbortSignal;
	/** Route selected only by server configuration. */
	readonly expectedReceiverId: string;
	/** Trusted server clock. */
	readonly nowEpochMs: () => number;
}
