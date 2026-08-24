import { describe, expect, it } from "vitest";

import { __EvaluateFleetMembershipRevision } from "../fleet-membership";
import type { FleetMembershipTrustExpectation, FleetSignatureVerificationEvidence, SignedFleetMembershipRevision } from "../fleet-membership.types";

/** Signed active-silo membership fixture. */
const REVISION: SignedFleetMembershipRevision = {
	revision: 2,
	issuerId: "fleet-1",
	issuerKeyId: "key-1",
	siloId: "silo-1",
	issuedAtEpochMs: 100,
	expiresAtEpochMs: 1_000,
	payloadDigest: "sha256:revision",
	signature: "signature",
	assertions: [{ assertionId: "assertion-1", siloId: "silo-1", subjectId: "subject-1" }],
};

/** Signature evidence bound to the fixture revision. */
const EVIDENCE: FleetSignatureVerificationEvidence = {
	verified: true,
	issuerId: REVISION.issuerId,
	issuerKeyId: REVISION.issuerKeyId,
	revision: REVISION.revision,
	siloId: REVISION.siloId,
	payloadDigest: REVISION.payloadDigest,
	signature: REVISION.signature,
};

/** Trust expectation for the active member. */
const EXPECTATION: FleetMembershipTrustExpectation = {
	trustedIssuerId: "fleet-1",
	siloId: "silo-1",
	subjectId: "subject-1",
	assertionId: "assertion-1",
	nowEpochMs: 200,
	lastAcceptedRevision: 1,
	maximumStalenessMs: 500,
};

describe("fleet membership", function _suite()
{
	it("trusts a current signed active-silo assertion", function _trusted()
	{
		expect(__EvaluateFleetMembershipRevision(REVISION, EVIDENCE, EXPECTATION)).toEqual({ outcome: "trusted", reason: "trusted", revision: 2, siloId: "silo-1", trustedUntilEpochMs: 600 });
	});

	it("rejects an assertion for another subject", function _subjectMismatch()
	{
		expect(__EvaluateFleetMembershipRevision(REVISION, EVIDENCE, { ...EXPECTATION, subjectId: "subject-2" })).toMatchObject({ outcome: "denied", reason: "assertion_mismatch" });
	});

	it("rejects rollback and mismatched signature evidence", function _envelopeMismatch()
	{
		expect(__EvaluateFleetMembershipRevision(REVISION, EVIDENCE, { ...EXPECTATION, lastAcceptedRevision: 3 })).toMatchObject({ outcome: "denied", reason: "revision_rollback" });
		expect(__EvaluateFleetMembershipRevision(REVISION, { ...EVIDENCE, payloadDigest: "sha256:other" }, EXPECTATION)).toMatchObject({ outcome: "denied", reason: "verification_evidence_mismatch" });
	});

	it("rejects stale signed membership", function _stale()
	{
		expect(__EvaluateFleetMembershipRevision(REVISION, EVIDENCE, { ...EXPECTATION, nowEpochMs: 600 })).toMatchObject({ outcome: "denied", reason: "stale" });
	});
});
