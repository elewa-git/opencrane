import type { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { RunInputSnapshotIdentityKinds, type RunInputSnapshotIdentity } from "@opencrane/contracts";
import type { FleetSignatureVerificationEvidence } from "@opencrane/models/authorization";

import type { FleetMembershipEvidenceConfig } from "../membership-authority.types";
import { PrismaRuntimeMembershipEligibilityAuthority } from "../prisma-runtime-membership-eligibility";

const _NOW = 2_000;
const _ROW = {
	id: "revision-row-7",
	revision: 7,
	issuerId: "fleet-1",
	issuerKeyId: "key-1",
	siloId: "silo-1",
	issuedAt: new Date(1_000),
	expiresAt: new Date(10_000),
	payloadDigest: "sha256:membership-7",
	signature: "signature-7",
	assertions: [{ assertionId: "assertion-1", siloId: "silo-1", subjectId: "user-1" }],
};

const _EVIDENCE: FleetSignatureVerificationEvidence = { verified: true, issuerId: "fleet-1", issuerKeyId: "key-1", revision: 7, siloId: "silo-1", payloadDigest: "sha256:membership-7", signature: "signature-7" };

function _Identity(): RunInputSnapshotIdentity
{
	return {
		kind: RunInputSnapshotIdentityKinds.User,
		executionSubjectId: "user-1",
		executionIssuer: "https://issuer.example",
		principalId: "principal-1",
		fleetMembershipRevision: 7,
		fleetMembershipIssuer: "fleet-1",
		fleetMembershipIssuerKeyId: "key-1",
		fleetMembershipAssertionId: "assertion-1",
		fleetMembershipPayloadDigest: "sha256:membership-7",
		fleetMembershipTrustedUntil: new Date(6_000).toISOString(),
	};
}

function _Authority(assertions = _ROW.assertions)
{
	const revision = { ..._ROW, assertions };
	const transaction = {
		verifiedFleetMembershipRevision: { findFirst: vi.fn().mockResolvedValue(revision) },
		highestAcceptedFleetMembership: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({}) },
		auditDecision: { create: vi.fn().mockResolvedValue({ id: "audit-1" }) },
	} as unknown as Prisma.TransactionClient;
	const config: FleetMembershipEvidenceConfig = { trustedIssuerId: "fleet-1", maximumStalenessMs: 5_000, verifier: { verify: vi.fn().mockResolvedValue(_EVIDENCE) } };
	return new PrismaRuntimeMembershipEligibilityAuthority(transaction, config);
}

describe("PrismaRuntimeMembershipEligibilityAuthority", function _Suite()
{
	it.each([
		["issuer", { fleetMembershipIssuer: "fleet-other" }],
		["assertion", { fleetMembershipAssertionId: "assertion-other" }],
		["revision", { fleetMembershipRevision: 6 }],
		["digest", { fleetMembershipPayloadDigest: "sha256:substituted" }],
		["issuer key", { fleetMembershipIssuerKeyId: "key-other" }],
		["expiry", { fleetMembershipTrustedUntil: new Date(1_999).toISOString() }],
	] as const)("rejects a frozen identity with a mismatched %s", async function _Rejects(_label, patch)
	{
		await expect(_Authority().isEligible({ siloId: "silo-1", identity: { ..._Identity(), ...patch } as RunInputSnapshotIdentity, nowEpochMs: _NOW })).resolves.toBe(false);
	});

	it("rejects a signed revision that has revoked the frozen subject assertion", async function _RejectsRevocation()
	{
		await expect(_Authority([]).isEligible({ siloId: "silo-1", identity: _Identity(), nowEpochMs: _NOW })).resolves.toBe(false);
	});
});
