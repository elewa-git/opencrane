/** Coordinates that conversations must prove before scheduling saves a routine proposal. */
export interface RequestRoutineProposalSource
{
	/** Silo that owns the source conversation and proposal. */
	readonly siloId: string;
	/** Conversation whose current readable history supplied the suggestion. */
	readonly sourceConversationId: string;
	/** Interactive run that produced the request. */
	readonly runId: string;
	/** Immutable attempt within the interactive run. */
	readonly attempt: number;
	/** Ordered first-party selection within the frozen interactive attempt. */
	readonly ordinal: number;
	/** Authenticated requester whose current membership and source access were checked. */
	readonly requesterPrincipalId: string;
}

/** Evidence returned after the conversation owner proves the current requester and source. */
export type RequestRoutineProposalSourceAuthorization = RequestRoutineProposalSource;

/** Rechecks requester membership, source readability and the frozen interactive request. */
export interface RequestRoutineProposalSourceAuthority
{
	/** Proves current requester access and the still-active frozen first-party request before creation. */
	authorizeCreation(source: RequestRoutineProposalSource): Promise<RequestRoutineProposalSourceAuthorization | null>;
	/** Proves current requester membership and source readability after the originating run has ended. */
	authorizeRequesterAccess(source: RequestRoutineProposalSource): Promise<RequestRoutineProposalSourceAuthorization | null>;
}

/** Builds the source authority over the transaction owned by the scheduling proposal write. */
export type RequestRoutineProposalSourceAuthorityFactory<Transaction> = (transaction: Transaction) => RequestRoutineProposalSourceAuthority;
