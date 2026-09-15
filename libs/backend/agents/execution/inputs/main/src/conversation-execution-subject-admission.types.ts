import type { AgentScope, ComputerLease, ComputerScope, ConversationComputer, RealizedLeaseScope } from "@opencrane/contracts";

/**
 * Captures the realization-neutral coordinates every conversation execution subject must recheck.
 *
 * The conversations package supplies this app-bound evidence with the triggering message. Personal
 * and managed subject authorities apply their own identity rules after the shared admission fence.
 */
export interface ConversationExecutionSubjectCoordinates
{
	/** Identifies the pending logical run. */
	readonly runId: string;
	/** Names the silo, conversation, computer and agent identity proven by the active computer projection. */
	readonly computer: ComputerScope;
	/** Names the bound agent service, its published revision and the computer profile revision. */
	readonly agent: AgentScope;
	/** Names the active lease, its generation and the realization whose process binding was verified. */
	readonly lease: RealizedLeaseScope;
	/** Identifies the human who authored the pending entry. */
	readonly requesterPrincipalId: string;
	/** Carries the issuer loaded from that exact durable Principal. */
	readonly requesterIssuer: string;
	/** Carries the subject loaded from that exact durable Principal. */
	readonly requesterSubjectId: string;
	/** Preserves the verified credential authentication instant on the immutable human author. */
	readonly requesterAuthenticatedAt: string;
	/** Identifies the immutable pending entry used for admission idempotency. */
	readonly requestIdempotencyKey: string;
}

/** Selects the computer whose current active lease the subject must recheck. */
export interface ActiveConversationComputerLeaseQuery
{
	/** Names the silo, conversation, computer and agent identity the stored snapshot must match. */
	readonly computer: ComputerScope;
	/** Identifies the immutable profile revision that must remain bound to this computer. */
	readonly profileRevisionId: string;
	/** Supplies the server-owned instant used to reject an expired lease. */
	readonly nowEpochMilliseconds: number;
}

/** Describes the current computer snapshot and active lease reported by the history owner. */
export interface ActiveConversationComputerLease
{
	/** Carries the current logical computer projection. */
	readonly computer: ConversationComputer;
	/** Carries the current active realization lease. */
	readonly lease: ComputerLease;
}

/** Reads the current active lease of one computer through the conversations history boundary. */
export interface ActiveConversationComputerLeaseReader
{
	/** Throws when the computer is missing, not warm, or its lease is not the current active one. */
	loadActiveLease(query: ActiveConversationComputerLeaseQuery): Promise<ActiveConversationComputerLease>;
}
