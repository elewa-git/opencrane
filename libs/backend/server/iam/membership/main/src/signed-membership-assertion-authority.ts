import { __AuthorizationScopesEqual, type AuthorizationScope } from "@opencrane/models/authorization";

import { __VerifyCurrentFleetMembership } from "./membership-authority.js";
import type { FleetMembershipAuthorityRepository, FleetMembershipEvidenceConfig, SignedFleetMembershipAssertionAuthority, VerifyFleetMembershipResult } from "./membership-authority.types.js";

/** Signed membership adapter that selects assertion identity from verified fleet evidence. */
export class SignedFleetMembershipAssertionVerifier implements SignedFleetMembershipAssertionAuthority
{
	/** Signed revision and monotonic acceptance repository. */
	private readonly repository: FleetMembershipAuthorityRepository;
	/** Deployment-owned issuer, verifier, and staleness policy. */
	private readonly evidence: FleetMembershipEvidenceConfig;

	/** Creates the adapter over one signed membership authority and trust configuration. */
	constructor(repository: FleetMembershipAuthorityRepository, evidence: FleetMembershipEvidenceConfig)
	{
		this.repository = repository;
		this.evidence = evidence;
	}

	/** Selects exactly one matching signed assertion before invoking current-membership verification. */
	async verifyCurrentMembership(subjectId: string, siloId: string, scope: AuthorizationScope, nowEpochMs: number): Promise<VerifyFleetMembershipResult>
	{
		// 1. Load only the newest revision from the deployment-trusted issuer; absence cannot imply membership.
		const revision = await this.repository.getLatestSignedRevision(this.evidence.trustedIssuerId, siloId);
		if (revision === null) return { outcome: "denied", reason: "missing_revision", revision: 0 };

		// 2. Select one exact signed assertion without accepting a caller-provided assertion identifier.
		const assertions = revision.assertions.filter(function _MatchesAssertion(assertion): boolean
		{
			return assertion.siloId === siloId && assertion.subjectId === subjectId && __AuthorizationScopesEqual(assertion.scope, scope);
		});
		if (assertions.length !== 1) return { outcome: "denied", reason: "assertion_mismatch", revision: revision.revision };

		// 3. Re-run the complete signature, freshness, scope, and monotonic-acceptance authority for that assertion.
		return __VerifyCurrentFleetMembership(this.repository, this.evidence.verifier, {
			trustedIssuerId: this.evidence.trustedIssuerId,
			siloId,
			subjectId,
			assertionId: assertions[0]!.assertionId,
			scope,
			nowEpochMs,
			maximumStalenessMs: this.evidence.maximumStalenessMs,
		});
	}
}
