import type { FleetMembershipSignatureVerifier } from "@opencrane/backend/server/iam/membership";
import type { InitialRunAuthority, RunAdmissionTransaction } from "@opencrane/backend/agents/execution/runs";
import type { CapabilitySetDigestSource, SessionAssemblyCommand } from "../session-assembly.types.js";
import { describe, expect, it, vi } from "vitest";

import { FleetMembershipIdentityEnvelopeSource } from "../fleet-membership-identity-envelope-source.js";

/** Creates one final-admission command bound to the exact signed assertion fixture. */
function _command(): SessionAssemblyCommand
{
	return { runId: "run-1", siloId: "silo-1", agentServiceId: "service-1", threadId: "thread-1", executionSubjectId: "user-1", requestIdempotencyKey: "request-1" };
}

/** Creates the immutable run authority needed only to request a capability-set digest. */
function _run(): InitialRunAuthority
{
	return { agentServiceId: "service-1", agentRevisionId: "revision-1", agentKind: "personal", effectiveContractDigest: `sha256:${"a".repeat(64)}`, promptCompilerVersion: "prompt-v1", trigger: "interactive", delegatedUserId: "user-1", rootRunId: "run-1", parentRunId: null };
}

/** Creates a verified signed revision row returned by both membership reads in one transaction. */
function _revisionRow()
{
	return { id: "membership-7", revision: 7, issuerId: "fleet-1", issuerKeyId: "key-1", siloId: "silo-1", issuedAt: new Date(9000), expiresAt: new Date(20000), payloadDigest: `sha256:${"b".repeat(64)}`, signature: "signature-7", assertions: [{ assertionId: "assertion-1", siloId: "silo-1", subjectId: "user-1", scopeKind: "Project", organizationId: "org-1", scopeResourceId: "project-1" }] };
}

/** Creates the one transaction client supplied by the run-owned admission repository. */
function _transaction(): RunAdmissionTransaction
{
	const row = _revisionRow();
	return {
		prisma: {
			$queryRaw: vi.fn().mockResolvedValue([]),
			verifiedFleetMembershipRevision: { findFirst: vi.fn().mockResolvedValue(row) },
			highestAcceptedFleetMembership: { findUnique: vi.fn().mockResolvedValue(null), upsert: vi.fn().mockResolvedValue({ revision: 7 }) },
			auditDecision: { create: vi.fn().mockResolvedValue({ id: "audit-1" }) },
		} as never,
		admittedAt: new Date(10000).toISOString(),
		admittedAtEpochMs: 10000,
	};
}

/** Verifies only a revision whose exact fields remain bound to the signature evidence. */
class _Verifier implements FleetMembershipSignatureVerifier
{
	/** Returns successful evidence for the exact signed revision under test. */
	async verify(revision: Parameters<FleetMembershipSignatureVerifier["verify"]>[0])
	{
		return { verified: true, issuerId: revision.issuerId, issuerKeyId: revision.issuerKeyId, revision: revision.revision, siloId: revision.siloId, payloadDigest: revision.payloadDigest, signature: revision.signature };
	}
}

/** Capability source that returns a precomputed proof-bound digest without leaving the transaction. */
class _CapabilitySet implements CapabilitySetDigestSource
{
	/** Returns the one valid digest used by this admission fixture. */
	async load()
	{
		return { outcome: "loaded", value: `sha256:${"c".repeat(64)}` } as const;
	}
}

describe("FleetMembershipIdentityEnvelopeSource", function _describeIdentityEnvelope()
{
	it("freezes only signed, fresh membership evidence and a same-transaction capability digest", async function _loadsVerifiedEnvelope()
	{
		const source = new FleetMembershipIdentityEnvelopeSource({ trustedIssuerId: "fleet-1", assertionId: "assertion-1", scope: { kind: "project", organizationId: "org-1", projectId: "project-1" }, maximumStalenessMs: 3000 }, new _Verifier(), new _CapabilitySet());
		const transaction = _transaction();

		await expect(source.load(_command(), _run(), transaction)).resolves.toEqual({ outcome: "loaded", value: { executionSubjectId: "user-1", fleetMembershipRevision: 7, fleetMembershipIssuer: "fleet-1", fleetMembershipIssuerKeyId: "key-1", fleetMembershipAssertionId: "assertion-1", fleetMembershipPayloadDigest: `sha256:${"b".repeat(64)}`, fleetMembershipTrustedUntil: new Date(12000).toISOString(), capabilitySetDigest: `sha256:${"c".repeat(64)}` } });
		expect(transaction.prisma.$queryRaw).toHaveBeenCalledOnce();
		expect(transaction.prisma.highestAcceptedFleetMembership.upsert).toHaveBeenCalledOnce();
	});

	it("fails closed when the capability digest is not a canonical SHA-256 value", async function _deniesInvalidCapabilityDigest()
	{
		const invalidCapabilitySet: CapabilitySetDigestSource = { load: async function _load() { return { outcome: "loaded", value: "not-a-digest" } as const; } };
		const source = new FleetMembershipIdentityEnvelopeSource({ trustedIssuerId: "fleet-1", assertionId: "assertion-1", scope: { kind: "project", organizationId: "org-1", projectId: "project-1" }, maximumStalenessMs: 3000 }, new _Verifier(), invalidCapabilitySet);

		await expect(source.load(_command(), _run(), _transaction())).resolves.toEqual({ outcome: "denied", reason: "identity_unavailable" });
	});
});
