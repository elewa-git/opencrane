import { describe, expect, it } from "vitest";
import { __EvaluateFleetMembershipRevision } from "../fleet-membership.js";
import type { FleetMembershipTrustExpectation, FleetSignatureVerificationEvidence, SignedFleetMembershipRevision } from "../fleet-membership.types.js";

/** Baseline signed fleet membership revision used by trust-boundary cases. */
const REVISION: SignedFleetMembershipRevision = {
	revision: 8,
	issuerId: "fleet-authority",
	issuerKeyId: "fleet-key-2",
	siloId: "silo-a",
	issuedAtEpochMs: 1_000,
	expiresAtEpochMs: 5_000,
	payloadDigest: "sha256:membership-8",
	signature: "signature-8",
	assertions: [{
		assertionId: "membership-a",
		siloId: "silo-a",
		subjectId: "user-a",
		scope: { kind: "project", organizationId: "org-a", projectId: "project-shared" },
	}],
};

/** Baseline explicit signature-verification evidence. */
const EVIDENCE: FleetSignatureVerificationEvidence = {
	verified: true,
	issuerId: "fleet-authority",
	issuerKeyId: "fleet-key-2",
	revision: 8,
	siloId: "silo-a",
	payloadDigest: "sha256:membership-8",
	signature: "signature-8",
};

/** Baseline expected trust boundary. */
const EXPECTATION: FleetMembershipTrustExpectation = {
	trustedIssuerId: "fleet-authority",
	siloId: "silo-a",
	subjectId: "user-a",
	assertionId: "membership-a",
	scope: { kind: "project", organizationId: "org-a", projectId: "project-shared" },
	nowEpochMs: 1_500,
	lastAcceptedRevision: 8,
	maximumStalenessMs: 2_000,
};

describe("signed fleet membership trust boundary", function ()
{
	it("trusts the last accepted signed revision while it remains fresh", function ()
	{
		expect(__EvaluateFleetMembershipRevision(REVISION, EVIDENCE, EXPECTATION)).toEqual({
			outcome: "trusted",
			reason: "trusted",
			revision: 8,
			organizationId: "org-a",
			trustedUntilEpochMs: 3_000,
		});
	});

	it("trusts a newer signed revision and rejects a revision rollback", function ()
	{
		const newerRevision: SignedFleetMembershipRevision = { ...REVISION, revision: 9 };
		const newerEvidence: FleetSignatureVerificationEvidence = { ...EVIDENCE, revision: 9 };
		const olderExpectation: FleetMembershipTrustExpectation = { ...EXPECTATION, lastAcceptedRevision: 7 };
		const rollbackExpectation: FleetMembershipTrustExpectation = { ...EXPECTATION, lastAcceptedRevision: 9 };

		expect(__EvaluateFleetMembershipRevision(newerRevision, newerEvidence, olderExpectation).outcome).toBe("trusted");
		expect(__EvaluateFleetMembershipRevision(REVISION, EVIDENCE, rollbackExpectation).reason).toBe("revision_rollback");
	});

	it("rejects invalid revision numbers on either side of the monotonic boundary", function ()
	{
		const invalidRevision: SignedFleetMembershipRevision = { ...REVISION, revision: 0 };
		const invalidEvidence: FleetSignatureVerificationEvidence = { ...EVIDENCE, revision: 0 };
		const invalidExpectation: FleetMembershipTrustExpectation = { ...EXPECTATION, lastAcceptedRevision: -1 };

		expect(__EvaluateFleetMembershipRevision(invalidRevision, invalidEvidence, EXPECTATION).reason).toBe("invalid_revision");
		expect(__EvaluateFleetMembershipRevision(REVISION, EVIDENCE, invalidExpectation).reason).toBe("invalid_revision");
	});

	it("rejects an issuer outside the configured trust boundary", function ()
	{
		const revision: SignedFleetMembershipRevision = { ...REVISION, issuerId: "other-fleet" };
		const evidence: FleetSignatureVerificationEvidence = { ...EVIDENCE, issuerId: "other-fleet" };

		expect(__EvaluateFleetMembershipRevision(revision, evidence, EXPECTATION).reason).toBe("untrusted_issuer");
	});

	it("rejects explicit evidence when signature verification failed", function ()
	{
		const evidence: FleetSignatureVerificationEvidence = { ...EVIDENCE, verified: false };

		expect(__EvaluateFleetMembershipRevision(REVISION, evidence, EXPECTATION).reason).toBe("signature_not_verified");
	});

	it("binds verification evidence to issuer key, revision, silo, digest, and signature", function ()
	{
		const mismatches: readonly FleetSignatureVerificationEvidence[] = [
			{ ...EVIDENCE, issuerId: "other-fleet" },
			{ ...EVIDENCE, issuerKeyId: "other-key" },
			{ ...EVIDENCE, revision: 7 },
			{ ...EVIDENCE, siloId: "silo-b" },
			{ ...EVIDENCE, payloadDigest: "sha256:other" },
			{ ...EVIDENCE, signature: "other-signature" },
		];

		for (const evidence of mismatches)
		{
			expect(__EvaluateFleetMembershipRevision(REVISION, evidence, EXPECTATION).reason)
				.toBe("verification_evidence_mismatch");
		}
	});

	it("requires the signed revision silo to match the expected silo", function ()
	{
		const revision: SignedFleetMembershipRevision = { ...REVISION, siloId: "silo-b" };
		const evidence: FleetSignatureVerificationEvidence = { ...EVIDENCE, siloId: "silo-b" };

		expect(__EvaluateFleetMembershipRevision(revision, evidence, EXPECTATION).reason).toBe("silo_mismatch");
	});

	it("rejects invalid caller time and maximum-staleness policy", function ()
	{
		const invalidNow: FleetMembershipTrustExpectation = { ...EXPECTATION, nowEpochMs: Number.NaN };
		const zeroStaleness: FleetMembershipTrustExpectation = { ...EXPECTATION, maximumStalenessMs: 0 };
		const fractionalStaleness: FleetMembershipTrustExpectation = { ...EXPECTATION, maximumStalenessMs: 1.5 };

		expect(__EvaluateFleetMembershipRevision(REVISION, EVIDENCE, invalidNow).reason).toBe("invalid_time_policy");
		expect(__EvaluateFleetMembershipRevision(REVISION, EVIDENCE, zeroStaleness).reason).toBe("invalid_time_policy");
		expect(__EvaluateFleetMembershipRevision(REVISION, EVIDENCE, fractionalStaleness).reason).toBe("invalid_time_policy");
	});

	it("rejects invalid issued and expiry bounds", function ()
	{
		const invalidIssued: SignedFleetMembershipRevision = { ...REVISION, issuedAtEpochMs: -1 };
		const invalidExpiry: SignedFleetMembershipRevision = { ...REVISION, expiresAtEpochMs: 1_000 };

		expect(__EvaluateFleetMembershipRevision(invalidIssued, EVIDENCE, EXPECTATION).reason).toBe("invalid_issued_at");
		expect(__EvaluateFleetMembershipRevision(invalidExpiry, EVIDENCE, EXPECTATION).reason).toBe("invalid_expiry");
	});

	it("rejects a revision issued in the future", function ()
	{
		const expectation: FleetMembershipTrustExpectation = { ...EXPECTATION, nowEpochMs: 999 };

		expect(__EvaluateFleetMembershipRevision(REVISION, EVIDENCE, expectation).reason).toBe("not_yet_valid");
	});

	it("fails closed at the exact signed-expiry boundary", function ()
	{
		const revision: SignedFleetMembershipRevision = { ...REVISION, expiresAtEpochMs: 2_000 };
		const expectation: FleetMembershipTrustExpectation = { ...EXPECTATION, nowEpochMs: 2_000 };

		expect(__EvaluateFleetMembershipRevision(revision, EVIDENCE, expectation).reason).toBe("expired");
	});

	it("fails closed at the exact maximum-staleness boundary", function ()
	{
		const expectation: FleetMembershipTrustExpectation = {
			...EXPECTATION,
			nowEpochMs: 3_000,
			maximumStalenessMs: 2_000,
		};

		expect(__EvaluateFleetMembershipRevision(REVISION, EVIDENCE, expectation).reason).toBe("stale");
	});

	it("uses signed expiry when it occurs before the staleness boundary", function ()
	{
		const revision: SignedFleetMembershipRevision = { ...REVISION, expiresAtEpochMs: 2_500 };
		const decision = __EvaluateFleetMembershipRevision(revision, EVIDENCE, EXPECTATION);

		expect(decision).toMatchObject({ outcome: "trusted", trustedUntilEpochMs: 2_500 });
	});

	it("requires the assertion identifier, silo, subject, and exact independent scope", function ()
	{
		const mismatches: readonly SignedFleetMembershipRevision[] = [
			{ ...REVISION, assertions: [{ ...REVISION.assertions[0], assertionId: "other" }] },
			{ ...REVISION, assertions: [{ ...REVISION.assertions[0], siloId: "silo-b" }] },
			{ ...REVISION, assertions: [{ ...REVISION.assertions[0], subjectId: "user-b" }] },
			{
				...REVISION,
				assertions: [{
					...REVISION.assertions[0],
					scope: { kind: "department", organizationId: "org-a", departmentId: "project-shared" },
				}],
			},
		];

		for (const revision of mismatches)
		{
			expect(__EvaluateFleetMembershipRevision(revision, EVIDENCE, EXPECTATION).reason)
				.toBe("assertion_mismatch");
		}
	});
});
