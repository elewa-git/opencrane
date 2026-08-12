/**
 * Holds one signed personal assertion, taken from a fleet-membership revision that named exactly one.
 *
 * A fleet-membership revision is a batch of assertions signed by a trusted issuer and stored locally
 * after verification, so admission can check "is this user still a member of this organisation"
 * against a signature rather than by calling the identity provider on every run. The subjects in it
 * are OIDC subject identifiers issued by Zitadel.
 */
export interface PersonalFleetMembershipAssertion
{
	/** The assertion id the signer put in the membership evidence. */
	readonly assertionId: string;
	/** The organisation the signer named as owner of this personal scope. */
	readonly organizationId: string;
}

/** Holds one active grant. Every grant is sorted, then hashed into the run's capability digest. */
export interface PersonalExecutionGrantFact
{
	/** Capability catalog identity. */
	readonly catalogId: string;
	/** Capability catalog revision. */
	readonly catalogRevision: number;
	/** Capability catalog content digest. */
	readonly catalogDigest: string;
	/** Granted capability identifier. */
	readonly capabilityId: string;
	/** Resource kind constrained by the grant. */
	readonly resourceKind: string;
	/** Resource identifier constrained by the grant. */
	readonly resourceId: string;
	/** Allow or deny effect from the durable grant. */
	readonly effect: string;
	/** Deterministic policy priority. */
	readonly priority: number;
	/** First instant at which this fact is valid. */
	readonly validFrom: Date;
	/** Optional final instant at which this fact remains valid. */
	readonly expiresAt: Date | null;
}

/** Reads the membership and grant facts frozen into a personal run, inside the admission transaction. */
export interface PersonalExecutionIdentityAuthorityRepository
{
	/** Loads the one candidate personal assertion, before its signature has been checked. */
	loadLatestPersonalAssertion(trustedIssuerId: string, siloId: string, subjectId: string): Promise<PersonalFleetMembershipAssertion | null>;
	/** Reads the assertion again from the exact revision the membership verifier accepted. */
	loadVerifiedPersonalAssertion(issuerId: string, siloId: string, revision: number, payloadDigest: string, subjectId: string): Promise<PersonalFleetMembershipAssertion | null>;
	/** Loads unrevoked, time-valid personal policy facts for a signed subject and organisation. */
	loadEffectivePersonalGrants(siloId: string, subjectId: string, organizationId: string, admittedAt: Date): Promise<readonly PersonalExecutionGrantFact[]>;
}
