import { ExecutionSubjectMembershipKinds } from "@opencrane/contracts";
import type { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import type { ExecutionSubject } from "@opencrane/contracts";
import type { FleetSignatureVerificationEvidence } from "@opencrane/models/authorization";

import { FleetMembershipDeploymentModes } from "../membership-authority.types";
import type { HumanMembershipEvidenceConfig } from "../human-membership.types";
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
		membership: { kind: ExecutionSubjectMembershipKinds.Fleet, principalId: "user-1", siloId: "silo-1", revision: 7, assertionId: "assertion-1", payloadDigest: "sha256:membership-7", decisionEvidenceId: "membership-decision-1", trustedUntil: new Date(6_000).toISOString() },
		capability: { agentIdentityId: "identity-1", computerId: "computer-1", capabilitySetDigest: `sha256:${"b".repeat(64)}`, effectiveContractDigest: `sha256:${"c".repeat(64)}`, decisionEvidenceId: "capability-decision-1", decidedAt: new Date(1_000).toISOString() },
		runScope: { siloId: "silo-1", runId: "run-1", attempt: 1, agentServiceId: "service-1", agentRevisionId: "revision-1" },
		computerScope: { siloId: "silo-1", computerId: "computer-1", leaseId: "lease-1", leaseGeneration: 1 },
		requester: { siloId: "silo-1", requesterPrincipalId: "user-1", requestIdempotencyKey: "request-1", authenticatedAt: new Date(1_000).toISOString(), membership: { kind: ExecutionSubjectMembershipKinds.Fleet, principalId: "user-1", siloId: "silo-1", revision: 7, assertionId: "assertion-1", payloadDigest: "sha256:membership-7", decisionEvidenceId: "membership-decision-1", trustedUntil: new Date(6_000).toISOString() } },
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
	const config: HumanMembershipEvidenceConfig = { mode: FleetMembershipDeploymentModes.Fleet, trustedIssuerId: "fleet-1", maximumStalenessMs: 5_000, verifier: { verify: vi.fn().mockResolvedValue(_EVIDENCE) } };
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

/** Rechecks a frozen local witness against the same transaction's current membership row. */
function _StandaloneAuthority()
{
	const original = _ExecutionSubject();
	const membership = { kind: ExecutionSubjectMembershipKinds.Standalone, principalId: "user-1", siloId: "silo-1", issuer: "https://issuer.test", subjectId: "oidc-1", membershipId: "local-1", membershipUpdatedAt: new Date(1_000).toISOString(), observedAt: new Date(2_000).toISOString(), trustedUntil: new Date(7_000).toISOString() } as const;
	const subject = { ...original, membership, requester: { ...original.requester, membership } };
	const row = { id: "local-1", clusterTenant: "silo-1", subject: "oidc-1", status: "Active", updatedAt: new Date(1_000) };
	const transaction = { principal: { findFirst: vi.fn().mockResolvedValue({ id: "user-1", siloId: "silo-1", issuer: "https://issuer.test", subject: "oidc-1", provenance: "External" }) }, orgMembership: { findUnique: vi.fn().mockResolvedValue(row) } };
	const authority = new PrismaRuntimeMembershipEligibilityAuthority(transaction as never, { mode: FleetMembershipDeploymentModes.Standalone, siloId: "silo-1", trustedOidcIssuer: "https://issuer.test", maximumStalenessMs: 5_000 });
	return { subject, row, transaction, authority };
}

describe("runtime local membership rechecks", function _StandaloneSuite()
{
	it("accepts a new observation of the original row without extending frozen trust", async function _SameVersion()
	{
		const f = _StandaloneAuthority();
		await expect(f.authority.isEligible({ siloId: "silo-1", executionSubject: f.subject, nowEpochMs: 3_000 })).resolves.toBe(true);
		await expect(f.authority.isEligible({ siloId: "silo-1", executionSubject: f.subject, nowEpochMs: 7_000 })).resolves.toBe(false);
		await expect(f.authority.isEligible({ siloId: "silo-1", executionSubject: f.subject, nowEpochMs: 1_500 })).resolves.toBe(false);
	});

	it.each([{ id: "replacement" }, { updatedAt: new Date(2_500) }, { status: "Suspended" }])("rejects changed local membership %j", async function _Changed(patch)
	{
		const f = _StandaloneAuthority();
		f.transaction.orgMembership.findUnique.mockResolvedValue({ ...f.row, ...patch });
		await expect(f.authority.isEligible({ siloId: "silo-1", executionSubject: f.subject, nowEpochMs: 3_000 })).resolves.toBe(false);
	});
});
