import type { ChannelTargetAuthorityRepository } from "@opencrane/backend/server/agents/channel-targets";
import type { ConversationProjectionClock, ConversationProjectionLimits } from "@opencrane/backend/conversations/projection";

import type { ConversationReplayUnitOfWork } from "./replay-reader.types.js";

/** Dependencies owned by the server composition root for internal conversation replay. */
export interface ConversationReplayRouterDependencies
{
	/** One-use channel-context authority. */
	readonly contexts: ChannelTargetAuthorityRepository;
	/** Canonical participant-bound replay reader. */
	readonly repository: ConversationReplayUnitOfWork;
	readonly clock: ConversationProjectionClock;
	readonly limits: ConversationProjectionLimits;
	/** Process shutdown signal that drains the stream before telemetry flush. */
	readonly shutdownSignal?: AbortSignal;
	/** Route selected only by server configuration. */
	readonly expectedReceiverId: string;
	/** Trusted server clock. */
	readonly nowEpochMs: () => number;
}
