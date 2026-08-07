import type { FleetMembershipTrustDecision, FleetMembershipTrustExpectation, FleetSignatureVerificationEvidence, SignedFleetMembershipRevision } from "./fleet-membership.types.js";
import { __AuthorizationScopesEqual } from "./scope-matching.js";

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
 * Checks that verification evidence is bound to every signed envelope field.
 * @param revision - Signed fleet membership revision.
 * @param evidence - Explicit evidence from the signature verifier.
 * @returns Whether the evidence belongs to the exact signed envelope.
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
 * Evaluates a signed fleet membership revision without performing crypto or I/O.
 * The caller supplies signature-verification evidence and time. Trust fails
 * closed at the earlier of the signed expiry or configured staleness boundary.
 * @param revision - Fleet-issued signed membership revision.
 * @param evidence - Explicit evidence from a trusted signature verifier.
 * @param expectation - Silo, subject, assertion, revision, and freshness boundary.
 * @returns Deterministic trust decision.
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
