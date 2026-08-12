import { __AuthorizationScopesEqual, type AuthorizationScope } from "@opencrane/models/authorization";

import { __VerifyCurrentFleetMembership } from "./membership-authority.js";
import type { FleetMembershipAuthorityRepository, FleetMembershipEvidenceConfig, SignedFleetMembershipAssertionAuthority, VerifyFleetMembershipResult } from "./membership-authority.types.js";

/**
 * Answers membership questions for callers that do not know which assertion applies.
 *
 * Given a subject, silo, and scope it reads the newest stored revision, finds the one assertion
 * matching all three, and hands that assertion to the full check. Requiring exactly one match is
 * deliberate: zero means no membership, and more than one means the stored revision is ambiguous, so
 * picking one would be guessing at authority.
 *
 * Called by: apps/opencrane/src/app/channel-target-composition.ts, which supplies it as the
 * `membership` dependency of channel-target resolution.
 * @implements SignedFleetMembershipAssertionAuthority
 */
export class SignedFleetMembershipAssertionVerifier implements SignedFleetMembershipAssertionAuthority
{
	/** Store of signed revisions and of the newest accepted revision per silo. */
	private readonly repository: FleetMembershipAuthorityRepository;
	/** Deployment-owned issuer, verifier, and staleness policy. */
	private readonly evidence: FleetMembershipEvidenceConfig;

	/**
	 * @param repository - Store of signed revisions and of the newest accepted revision per silo.
	 * @param evidence - Startup-built trusted issuer, staleness limit, and signature verifier.
	 */
	constructor(repository: FleetMembershipAuthorityRepository, evidence: FleetMembershipEvidenceConfig)
	{
		this.repository = repository;
		this.evidence = evidence;
	}

	/**
	 * @param subjectId - Subject whose membership is in question.
	 * @param siloId - Silo the request is happening in.
	 * @param scope - Scope the subject must be a member at.
	 * @param nowEpochMs - Current time in epoch milliseconds, from the caller.
	 * @returns `trusted` with the trust window; `denied` with `missing_revision` when nothing is
	 *          stored, `assertion_mismatch` when zero or several assertions match, or the reason the
	 *          full check refused.
	 */
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
