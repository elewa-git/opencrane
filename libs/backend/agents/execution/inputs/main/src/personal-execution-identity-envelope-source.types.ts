/** One signed personal assertion selected from an unambiguous fleet-membership revision. */
export interface PersonalFleetMembershipAssertion
{
	/** Signer-chosen assertion identifier bound into the membership evidence. */
	readonly assertionId: string;
	/** Signer-chosen organisation that owns the personal scope. */
	readonly organizationId: string;
}

/** One current grant fact whose canonical form is sealed into the personal capability digest. */
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

/** Repository contract for the transaction-fenced membership and grant facts frozen into a personal run. */
export interface PersonalExecutionIdentityAuthorityRepository
{
	/** Loads the single candidate personal assertion before cryptographic verification. */
	loadLatestPersonalAssertion(trustedIssuerId: string, siloId: string, subjectId: string): Promise<PersonalFleetMembershipAssertion | null>;
	/** Re-reads the exact signed revision selected by the membership verifier. */
	loadVerifiedPersonalAssertion(issuerId: string, siloId: string, revision: number, payloadDigest: string, subjectId: string): Promise<PersonalFleetMembershipAssertion | null>;
	/** Loads unrevoked, time-valid personal policy facts for a signed subject and organisation. */
	loadEffectivePersonalGrants(siloId: string, subjectId: string, organizationId: string, admittedAt: Date): Promise<readonly PersonalExecutionGrantFact[]>;
}
