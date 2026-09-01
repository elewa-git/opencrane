/**
 * Carries the current authority facts used to reject a stale execution subject.
 *
 * Runtime dispatch compares the assignment and frozen snapshot against this context before sending
 * work to a computer. A mismatch means the caller must deny dispatch: requester provenance and an
 * older subject cannot authorize the work by themselves.
 */
export interface ExecutionSubjectVerificationContext
{
	/** Identifies the silo in which the authority loaded every current coordinate. */
	readonly siloId: string;
	/** Identifies the current agent identity. */
	readonly agentIdentityId: string;
	/** Identifies the principal currently realized by that identity. */
	readonly principalId: string;
	/** Stores the exact current zero-based Kurrent identity-head revision in canonical decimal. */
	readonly identityHeadRevision: string;
	/** Stores the digest of the exact current identity head. */
	readonly identityHeadDigest: string;
	/** Identifies the authority decision that verified the current identity head. */
	readonly identityDecisionEvidenceId: string;
	/** Stores when the authority verified the current identity head. */
	readonly identityVerifiedAt: string;
	/** Stores the current signed membership revision for the realized principal. */
	readonly membershipRevision: number;
	/** Identifies the current signed membership assertion. */
	readonly membershipAssertionId: string;
	/** Stores the digest of the current signed membership assertion. */
	readonly membershipPayloadDigest: string;
	/** Identifies the authority decision that verified current membership. */
	readonly membershipDecisionEvidenceId: string;
	/** Stores the current membership-expiry instant. */
	readonly membershipTrustedUntil: string;
	/** Stores the current admitted capability-set digest. */
	readonly capabilitySetDigest: string;
	/** Stores the effective authorization-contract digest for this subject. */
	readonly effectiveContractDigest: string;
	/** Identifies the authority decision that admitted the current capability set. */
	readonly capabilityDecisionEvidenceId: string;
	/** Stores when the authority admitted the current capability set. */
	readonly capabilityDecidedAt: string;
	/** Identifies the one admitted run. */
	readonly runId: string;
	/** Stores the active positive run attempt. */
	readonly attempt: number;
	/** Identifies the agent service admitted for the run. */
	readonly agentServiceId: string;
	/** Identifies the immutable agent revision admitted for the run. */
	readonly agentRevisionId: string;
	/** Identifies the current conversation computer. */
	readonly computerId: string;
	/** Identifies the current computer lease. */
	readonly computerLeaseId: string;
	/** Stores the current positive computer lease generation. */
	readonly computerLeaseGeneration: number;
	/** Stores the server-owned instant that fences membership expiry checks. */
	readonly nowEpochMilliseconds: number;
	/** Identifies the authenticated requester that originated this admission. */
	readonly requesterPrincipalId: string;
	/** Identifies the immutable request idempotency key for this admission. */
	readonly requestIdempotencyKey: string;
	/** Stores when the requester was authenticated. */
	readonly requesterAuthenticatedAt: string;
	/** Identifies the principal whose authority admitted execution. */
	readonly authorizingPrincipalId: string;
	/** Identifies the current admission authority decision. */
	readonly admissionDecisionEvidenceId: string;
	/** Stores when the current admission authority accepted execution. */
	readonly admissionAdmittedAt: string;
}
