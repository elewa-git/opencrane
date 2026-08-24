import type { FleetSignatureVerificationEvidence, SignedFleetMembershipRevision } from "@opencrane/models/authorization";
import { describe, expect, it, vi } from "vitest";

import type { FleetMembershipAuthorityRepository, FleetMembershipEvidenceConfig } from "../membership-authority.types";
import { SignedFleetMembershipAssertionVerifier } from "../signed-membership-assertion-authority";

/** Stable signed revision with one silo-membership assertion. */
const _REVISION: SignedFleetMembershipRevision = {
	revision: 7,
	issuerId: "fleet-1",
	issuerKeyId: "key-1",
	siloId: "silo-1",
	issuedAtEpochMs: 1_000,
	expiresAtEpochMs: 10_000,
	payloadDigest: "sha256:membership",
	signature: "signature",
	assertions: [{ assertionId: "assertion-1", siloId: "silo-1", subjectId: "user-1" }],
};

/** Signature evidence bound to the stable revision. */
const _SIGNATURE_EVIDENCE: FleetSignatureVerificationEvidence = { verified: true, issuerId: "fleet-1", issuerKeyId: "key-1", revision: 7, siloId: "silo-1", payloadDigest: "sha256:membership", signature: "signature" };

/** Build the minimal signed membership repository used by the adapter tests. */
function _Repository(revision: SignedFleetMembershipRevision | null = _REVISION): FleetMembershipAuthorityRepository
{
	return {
		getLatestSignedRevision: vi.fn(async function _GetLatest() { return revision; }),
		getHighestAcceptedRevision: vi.fn(async function _GetHighest() { return 0; }),
		acceptRevisionAtomically: vi.fn(async function _Accept() { return { status: "accepted", highestAcceptedRevision: 7 } as const; }),
	};
}

/** Build deployment-owned signature and freshness evidence. */
function _Evidence(): FleetMembershipEvidenceConfig
{
	return { trustedIssuerId: "fleet-1", maximumStalenessMs: 5_000, verifier: { verify: vi.fn(async function _Verify() { return _SIGNATURE_EVIDENCE; }) } };
}

describe("signed fleet-membership assertion adapter", function _Suite()
{
	it("selects the exact signed assertion without accepting a caller-selected assertion id", async function _SelectsAssertion()
	{
		const repository = _Repository();
		const authority = new SignedFleetMembershipAssertionVerifier(repository, _Evidence());

		await expect(authority.verifyCurrentMembership("user-1", "silo-1", 2_000)).resolves.toEqual({ outcome: "trusted", revision: 7, trustedUntilEpochMs: 6_000 });
		expect(repository.acceptRevisionAtomically).toHaveBeenCalledWith(expect.objectContaining({ issuerId: "fleet-1", revision: 7 }));
	});

	it("fails closed when no exact subject assertion exists", async function _RejectsMismatch()
	{
		const repository = _Repository();
		const evidence = _Evidence();
		const authority = new SignedFleetMembershipAssertionVerifier(repository, evidence);

		await expect(authority.verifyCurrentMembership("user-other", "silo-1", 2_000)).resolves.toEqual({ outcome: "denied", reason: "assertion_mismatch", revision: 7 });
		expect(evidence.verifier.verify).not.toHaveBeenCalled();
	});

	it("fails closed when the trusted issuer has no signed revision", async function _RejectsMissingRevision()
	{
		const authority = new SignedFleetMembershipAssertionVerifier(_Repository(null), _Evidence());

		await expect(authority.verifyCurrentMembership("user-1", "silo-1", 2_000)).resolves.toEqual({ outcome: "denied", reason: "missing_revision", revision: 0 });
	});
});
