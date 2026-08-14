import type { ChannelTargetAuthorityRepository } from "@opencrane/backend/server/agents/channel-targets";
import type { ConversationProjectionClock, ConversationProjectionLimits } from "@opencrane/backend/conversations/projection";

import type { ConversationReplayUnitOfWork } from "./replay-reader.types";

/** Dependencies owned by the server composition root for internal conversation replay. */
export interface ConversationReplayRouterDependencies
{
	/**
	 * Spends the caller's bearer token. The spend is atomic and single-use, so the same token
	 * cannot open two streams, and the conversation, silo, and subject are then taken from the
	 * consumed context rather than from the request.
	 */
	readonly contexts: ChannelTargetAuthorityRepository;
	/** Canonical participant-bound replay reader. */
	readonly repository: ConversationReplayUnitOfWork;
	readonly clock: ConversationProjectionClock;
	readonly limits: ConversationProjectionLimits;
	/** Process shutdown signal that drains the stream before telemetry flush. */
	readonly shutdownSignal?: AbortSignal;
	/** The receiver id an incoming context token must be addressed to. Set from server configuration; a token for any other receiver is refused with 403. */
	readonly expectedReceiverId: string;
	/** Trusted server clock. */
	readonly nowEpochMs: () => number;
}
