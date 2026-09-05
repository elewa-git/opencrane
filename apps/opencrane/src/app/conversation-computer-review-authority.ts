import { ConversationComputerHistory, type ConversationMetadataAuthority } from "@opencrane/backend/server/conversations";

import type { ConversationComputerReviewAuthority, ConversationComputerReviewCaller, ConversationComputerReviewRoute } from "./conversation-computer-review.types";

/** Joins metadata Read authorization with the current canonical computer lease. */
export class _ConversationComputerReviewAuthority implements ConversationComputerReviewAuthority
{
	/** Bind the projection authority and canonical history reader used by every review request. */
	public constructor(private readonly metadata: Pick<ConversationMetadataAuthority, "reviewCoordinates">, private readonly history: ConversationComputerHistory) {}

	/** @inheritdoc */
	public async resolve(caller: ConversationComputerReviewCaller, conversationId: string): Promise<ConversationComputerReviewRoute | null>
	{
		const coordinates = await this.metadata.reviewCoordinates(caller, conversationId);
		if (coordinates === null)
			return null;
		const current = await this.history.loadActiveLease({ siloId: caller.siloId, conversationId, computerId: coordinates.computerId, agentIdentityId: coordinates.agentIdentityId, profileRevisionId: coordinates.profileRevisionId, nowEpochMilliseconds: Date.now() });
		if (current.lease.sandboxId === null)
			return null;
		return { leaseId: current.lease.id, sandboxId: current.lease.sandboxId };
	}
}
