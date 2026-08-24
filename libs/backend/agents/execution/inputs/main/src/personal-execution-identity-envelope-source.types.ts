/**
 * Holds one signed silo-membership assertion, taken from a revision that named exactly one.
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
}

/** Reads the membership and grant facts frozen into a personal run, inside the admission transaction. */
export interface PersonalExecutionIdentityAuthorityRepository
{
	/** Resolves the local Principal for one exact verified OIDC identity. */
	resolvePrincipalId(siloId: string, issuer: string, subjectId: string): Promise<string | null>;
	/** Loads the one candidate personal assertion, before its signature has been checked. */
	loadLatestPersonalAssertion(trustedIssuerId: string, siloId: string, subjectId: string): Promise<PersonalFleetMembershipAssertion | null>;
	/** Reads the assertion again from the exact revision the membership verifier accepted. */
	loadVerifiedPersonalAssertion(issuerId: string, siloId: string, revision: number, payloadDigest: string, subjectId: string): Promise<PersonalFleetMembershipAssertion | null>;
}
