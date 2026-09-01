import type { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import type { ExecutionSubject } from "@opencrane/contracts";
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

function _ExecutionSubject(): ExecutionSubject
{
	return {
		schemaVersion: 1,
		siloId: "silo-1",
		agentIdentityId: "identity-1",
		principalId: "user-1",
		identity: { agentIdentityId: "identity-1", principalId: "user-1", siloId: "silo-1", headRevision: "7", headDigest: `sha256:${"a".repeat(64)}`, decisionEvidenceId: "identity-decision-1", verifiedAt: new Date(1_000).toISOString() },
		membership: { principalId: "user-1", siloId: "silo-1", revision: 7, assertionId: "assertion-1", payloadDigest: "sha256:membership-7", decisionEvidenceId: "membership-decision-1", trustedUntil: new Date(6_000).toISOString() },
		capability: { agentIdentityId: "identity-1", computerId: "computer-1", capabilitySetDigest: `sha256:${"b".repeat(64)}`, effectiveContractDigest: `sha256:${"c".repeat(64)}`, decisionEvidenceId: "capability-decision-1", decidedAt: new Date(1_000).toISOString() },
		runScope: { siloId: "silo-1", runId: "run-1", attempt: 1, agentServiceId: "service-1", agentRevisionId: "revision-1" },
		computerScope: { siloId: "silo-1", computerId: "computer-1", leaseId: "lease-1", leaseGeneration: 1 },
		requester: { siloId: "silo-1", requesterPrincipalId: "user-1", requestIdempotencyKey: "request-1", authenticatedAt: new Date(1_000).toISOString() },
		admission: { authorizingPrincipalId: "user-1", decisionEvidenceId: "admission-decision-1", admittedAt: new Date(1_000).toISOString() },
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
	it("accepts the current signed assertion bound to the execution subject", async function _AcceptsCurrentSubject()
	{
		await expect(_Authority().isEligible({ siloId: "silo-1", executionSubject: _ExecutionSubject(), nowEpochMs: _NOW })).resolves.toBe(true);
	});

	it.each([
		["assertion", { membership: { ..._ExecutionSubject().membership, assertionId: "assertion-other" } }],
		["revision", { membership: { ..._ExecutionSubject().membership, revision: 6 } }],
		["digest", { membership: { ..._ExecutionSubject().membership, payloadDigest: "sha256:substituted" } }],
		["expiry", { membership: { ..._ExecutionSubject().membership, trustedUntil: new Date(1_999).toISOString() } }],
		["principal", { membership: { ..._ExecutionSubject().membership, principalId: "principal-other" } }],
	] as const)("rejects a frozen identity with a mismatched %s", async function _Rejects(_label, patch)
	{
		await expect(_Authority().isEligible({ siloId: "silo-1", executionSubject: { ..._ExecutionSubject(), ...patch } as ExecutionSubject, nowEpochMs: _NOW })).resolves.toBe(false);
	});

	it("rejects a signed revision that has revoked the frozen subject assertion", async function _RejectsRevocation()
	{
		await expect(_Authority([]).isEligible({ siloId: "silo-1", executionSubject: _ExecutionSubject(), nowEpochMs: _NOW })).resolves.toBe(false);
	});
});
