import type { FleetMembershipTrustDecision, FleetMembershipTrustExpectation, FleetSignatureVerificationEvidence, SignedFleetMembershipRevision } from "./fleet-membership.types";
import { __AuthorizationScopesEqual } from "./scope-matching";

/**
 * Creates a denied fleet-membership result for one revision.
 * @param revision - Revision evaluated at the trust boundary.
 * @param reason - Stable rejection reason.
 * @returns Fail-closed denial result.
 */
function _deny(
	revision: number,
	reason: Exclude<FleetMembershipTrustDecision["reason"], "trusted">,
): FleetMembershipTrustDecision
{
	return { outcome: "denied", reason, revision };
}

/**
 * Checks that the verifier's evidence describes this exact signed revision, field by field.
 *
 * Without this, a caller could pass evidence from a different, validly signed revision and have
 * it accepted for this one.
 * @param revision - Signed fleet membership revision.
 * @param evidence - What the signature verifier reported.
 * @returns True only when issuer, key id, revision number, silo, digest, and signature all match.
 */
function _verificationEvidenceMatches(
	revision: SignedFleetMembershipRevision,
	evidence: FleetSignatureVerificationEvidence,
): boolean
{
	return evidence.issuerId === revision.issuerId
		&& evidence.issuerKeyId === revision.issuerKeyId
		&& evidence.revision === revision.revision
		&& evidence.siloId === revision.siloId
		&& evidence.payloadDigest === revision.payloadDigest
		&& evidence.signature === revision.signature;
}

/**
 * Decide whether a signed fleet-membership revision can be trusted for one subject.
 *
 * This function does no cryptography and no I/O. The caller verifies the signature elsewhere and
 * passes the result in as `evidence`, and passes the current time in as part of `expectation`, so
 * the decision is a pure function and can be replayed from an audit record.
 *
 * Trust ends at whichever comes first: the revision's own signed expiry, or the caller's staleness
 * limit. A revision number lower than one already accepted for the silo is rejected, which is what
 * stops an old signed snapshot being replayed.
 *
 * Fails closed. A denial deliberately exposes no identity taken from the assertion, so a caller
 * must not read organization or subject data out of a denied result.
 *
 * Called by: `libs/backend/server/iam/membership/main/src/membership-authority.ts`.
 * @param revision - The signed membership revision to evaluate.
 * @param evidence - What a trusted signature verifier reported about that revision.
 * @param expectation - Expected issuer, silo, subject, assertion, last-accepted revision, current time, and staleness limit.
 * @returns A trusted decision carrying the matched organization and the time trust expires, or a denial carrying only a stable reason.
 * @see {@link FleetMembershipTrustReason}
 */
export function __EvaluateFleetMembershipRevision(
	revision: SignedFleetMembershipRevision,
	evidence: FleetSignatureVerificationEvidence,
	expectation: FleetMembershipTrustExpectation,
): FleetMembershipTrustDecision
{
	// 1. Caller-supplied time and freshness bounds must be finite positive integers.
	if (!Number.isSafeInteger(expectation.nowEpochMs)
		|| expectation.nowEpochMs < 0
		|| !Number.isSafeInteger(expectation.maximumStalenessMs)
		|| expectation.maximumStalenessMs <= 0)
	{
		return _deny(revision.revision, "invalid_time_policy");
	}

	// 2. Revision ordering prevents replay of an older signed membership snapshot.
	if (!Number.isSafeInteger(revision.revision)
		|| revision.revision <= 0
		|| !Number.isSafeInteger(expectation.lastAcceptedRevision)
		|| expectation.lastAcceptedRevision < 0)
	{
		return _deny(revision.revision, "invalid_revision");
	}
	if (revision.revision < expectation.lastAcceptedRevision)
	{
		return _deny(revision.revision, "revision_rollback");
	}

	// 3. Explicit cryptographic evidence must bind the exact trusted signed envelope.
	if (revision.issuerId !== expectation.trustedIssuerId)
	{
		return _deny(revision.revision, "untrusted_issuer");
	}
	if (!evidence.verified)
	{
		return _deny(revision.revision, "signature_not_verified");
	}
	if (!_verificationEvidenceMatches(revision, evidence))
	{
		return _deny(revision.revision, "verification_evidence_mismatch");
	}
	if (revision.siloId !== expectation.siloId)
	{
		return _deny(revision.revision, "silo_mismatch");
	}

	// 4. Signed issuance and expiry bounds reject malformed, future, expired, or stale data.
	if (!Number.isSafeInteger(revision.issuedAtEpochMs) || revision.issuedAtEpochMs < 0)
	{
		return _deny(revision.revision, "invalid_issued_at");
	}
	if (!Number.isSafeInteger(revision.expiresAtEpochMs)
		|| revision.expiresAtEpochMs <= revision.issuedAtEpochMs)
	{
		return _deny(revision.revision, "invalid_expiry");
	}
	if (revision.issuedAtEpochMs > expectation.nowEpochMs)
	{
		return _deny(revision.revision, "not_yet_valid");
	}
	if (expectation.nowEpochMs >= revision.expiresAtEpochMs)
	{
		return _deny(revision.revision, "expired");
	}
	const staleAtEpochMs = revision.issuedAtEpochMs + expectation.maximumStalenessMs;
	if (!Number.isSafeInteger(staleAtEpochMs)
		|| expectation.nowEpochMs >= staleAtEpochMs)
	{
		return _deny(revision.revision, "stale");
	}

	// 5. The signed assertion must match the exact silo, subject, identifier, and scope expected.
	const matchedAssertion = revision.assertions.find(assertion =>
		assertion.assertionId === expectation.assertionId
			&& assertion.siloId === expectation.siloId
			&& assertion.subjectId === expectation.subjectId
			&& __AuthorizationScopesEqual(assertion.scope, expectation.scope));
	if (matchedAssertion === undefined)
	{
		return _deny(revision.revision, "assertion_mismatch");
	}

	return {
		outcome: "trusted",
		reason: "trusted",
		revision: revision.revision,
		organizationId: matchedAssertion.scope.organizationId,
		trustedUntilEpochMs: Math.min(revision.expiresAtEpochMs, staleAtEpochMs),
	};
}
