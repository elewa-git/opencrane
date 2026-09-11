import { ConversationComputerHistory, _LeaseScopeOf } from "../conversation-computers";
import { ProductAuthorizationActions } from "@opencrane/models/authorization";
import { ConversationComputerRealizationKinds } from "@opencrane/contracts";
import type { ConversationMetadataAuthority } from "../conversation-metadata.types";

import type { ConversationComputerReviewAuthority, ConversationComputerReviewCaller, ConversationComputerReviewCredentialDeriver, ConversationComputerReviewRoute } from "./conversation-computer-review.types";

/**
 * Resolves a participant-authorized conversation to its active computer lease.
 *
 * The public router supplies `Read` for inspection and `Use` for commands or browser changes. This
 * authority applies that action through conversation metadata before it reads the active lease, so
 * a caller cannot learn sandbox coordinates from a conversation it cannot access. Missing sandbox
 * coordinates return `null` and the router exposes the same unavailable response as failed admission.
 * The returned route carries the derived review bearer for every keyring key, never the public lease id.
 *
 * Called by: `_CreateConversationComputerReviewRouter` through `ConversationComputerReviewAuthority`.
 *
 * @implements ConversationComputerReviewAuthority
 * @see ConversationMetadataAuthority.reviewCoordinates
 * @see ConversationComputerHistory.loadActiveLease
 */
export class _ConversationComputerReviewAuthority implements ConversationComputerReviewAuthority
{
	/** Binds metadata admission, the active-lease history reader, and the keyed credential deriver used by review requests. */
	public constructor(private readonly metadata: Pick<ConversationMetadataAuthority, "reviewCoordinates">, private readonly history: ConversationComputerHistory, private readonly credentials: ConversationComputerReviewCredentialDeriver) {}

	/** @inheritdoc */
	public async resolve(caller: ConversationComputerReviewCaller, conversationId: string, action: ProductAuthorizationActions): Promise<ConversationComputerReviewRoute | null>
	{
		const coordinates = await this.metadata.reviewCoordinates(caller, conversationId, action);
		if (coordinates === null)
			return null;
		const current = await this.history.loadActiveLease({ computer: { siloId: caller.siloId, conversationId, computerId: coordinates.computerId, agentIdentityId: coordinates.agentIdentityId }, profileRevisionId: coordinates.profileRevisionId, nowEpochMilliseconds: Date.now() });
		if (current.lease.realization.kind !== ConversationComputerRealizationKinds.AgentSandbox || current.lease.realization.sandboxId === null)
			return null;
		if (current.lease.realization.serviceFQDN === null)
			return null;
		const reviewCredential = this.credentials.bearer({ siloId: caller.siloId, computerId: coordinates.computerId, lease: _LeaseScopeOf(current.lease) });
		return { reviewCredential, sandboxId: current.lease.realization.sandboxId, serviceFQDN: current.lease.realization.serviceFQDN };
	}
}
