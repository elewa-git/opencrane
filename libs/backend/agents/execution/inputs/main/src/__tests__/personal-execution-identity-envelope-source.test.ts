import type { FleetMembershipSignatureVerifier } from "@opencrane/backend/server/iam/membership";
import type { InitialRunAuthority, RunAdmissionTransaction } from "@opencrane/backend/agents/execution/runs";
import { describe, expect, it, vi } from "vitest";

import { AgentServiceKinds } from "@opencrane/models/agents";

import { PersonalExecutionIdentityEnvelopeSource } from "../personal-execution-identity-envelope-source";
import type { SessionAssemblyCommand } from "../session-assembly.types";

/** Builds a final-admission command whose silo and subject came from trusted server context. */
function _Command(): Extract<SessionAssemblyCommand, { readonly identityKind: "user" }>
{
	return { runId: "run-1", siloId: "silo-1", agentServiceId: "service-1", conversationId: "conversation-1", identityKind: "user", trigger: "interactive", executionIssuer: "https://issuer.test", executionSubjectId: "user-1", requestIdempotencyKey: "request-1" };
}

/** Builds the run authority whose personal kind is required for a browser-session admission. */
function _Run(): InitialRunAuthority
{
	return { agentServiceId: "service-1", agentRevisionId: "revision-1", agentKind: AgentServiceKinds.Personal, effectiveContractDigest: `sha256:${"a".repeat(64)}`, promptCompilerVersion: "prompt-v1", trigger: "interactive", delegatedUserId: "user-1", rootRunId: "run-1", parentRunId: null };
}

/** Builds one verified revision with the single signed personal assertion available to this user. */
function _Revision(assertions = [{ assertionId: "assertion-1", siloId: "silo-1", subjectId: "user-1" }])
{
	return { id: "membership-7", revision: 7, issuerId: "fleet-1", issuerKeyId: "key-1", siloId: "silo-1", issuedAt: new Date(9000), expiresAt: new Date(20000), payloadDigest: `sha256:${"b".repeat(64)}`, signature: "signature-7", assertions };
}

/** Builds the fake transaction, with tables for signed membership, the high-watermark, audit rows, and grants. */
function _Transaction(row = _Revision()): RunAdmissionTransaction
{
	return {
		prisma: {
			principal: {
				findMany: vi.fn().mockResolvedValue([{ id: "principal-1" }]),
				findUnique: vi.fn().mockResolvedValue({ id: "principal-1" }),
			},
			groupMembership: { findMany: vi.fn().mockResolvedValue([]) },
			verifiedFleetMembershipRevision: { findFirst: vi.fn().mockResolvedValue(row) },
				highestAcceptedFleetMembership: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({ revision: 7 }) },
			auditDecision: { create: vi.fn().mockResolvedValue({ id: "audit-1" }) },
			authorizationGrant: { findMany: vi.fn().mockResolvedValue([{ id: "grant-1", siloId: "silo-1", subjectKind: "Principal", subjectGroupId: null, subjectPrincipalId: "principal-1", boundaryKind: "Personal", boundaryGroupId: null, boundaryPrincipalId: "principal-1", boundaryCoverage: "Exact", catalogId: "catalog-1", catalogRevision: 3, catalogDigest: `sha256:${"c".repeat(64)}`, capabilityId: "conversation:run", resourceKind: "conversation", resourceId: "conversation-1", effect: "Allow", priority: 10, validFrom: new Date(8000), expiresAt: null, revokedAt: null }]) },
		} as never,
		admittedAt: new Date(10000).toISOString(),
		admittedAtEpochMs: 10000,
	};
}

/** Fake verifier that accepts only the signed revision the server passed in. */
class _Verifier implements FleetMembershipSignatureVerifier
{
	/** Returns successful verification evidence bound exactly to the signed revision argument. */
	async verify(revision: Parameters<FleetMembershipSignatureVerifier["verify"]>[0])
	{
		return { verified: true, issuerId: revision.issuerId, issuerKeyId: revision.issuerKeyId, revision: revision.revision, siloId: revision.siloId, payloadDigest: revision.payloadDigest, signature: revision.signature };
	}
}

/** Creates a source that permits at most three seconds between signature issuance and admission. */
function _Source(): PersonalExecutionIdentityEnvelopeSource
{
	return new PersonalExecutionIdentityEnvelopeSource({ trustedIssuerId: "fleet-1", maximumStalenessMs: 3000, verifier: new _Verifier() });
}

describe("PersonalExecutionIdentityEnvelopeSource", function _describePersonalIdentityEnvelope()
{
	it("freezes exact signed membership and same-transaction effective personal grants", async function _freezesTrustedFacts()
	{
		const transaction = _Transaction();
		const result = await _Source().load(_Command(), _Run(), transaction);

		expect(result).toMatchObject({ outcome: "loaded", value: { executionSubjectId: "user-1", principalId: "principal-1", fleetMembershipRevision: 7, fleetMembershipAssertionId: "assertion-1", capabilitySetDigest: expect.stringMatching(/^sha256:/) } });
		expect(transaction.prisma.principal.findUnique).toHaveBeenCalledWith({ where: { siloId_issuer_subject: { siloId: "silo-1", issuer: "https://issuer.test", subject: "user-1" } }, select: { id: true } });
		expect(transaction.prisma.authorizationGrant.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ siloId: "silo-1", OR: [{ subjectKind: "Principal", subjectPrincipalId: "principal-1", subjectGroupId: null }] }) }));
	});

	it("fails closed when the same subject belongs to another OIDC issuer", async function _deniesForeignIssuer()
	{
		const transaction = _Transaction();
		vi.mocked(transaction.prisma.principal.findUnique).mockResolvedValue(null);

		await expect(_Source().load({ ..._Command(), executionIssuer: "https://attacker.test" }, _Run(), transaction)).resolves.toEqual({ outcome: "denied", reason: "identity_unavailable" });
		expect(transaction.prisma.principal.findUnique).toHaveBeenCalledWith({ where: { siloId_issuer_subject: { siloId: "silo-1", issuer: "https://attacker.test", subject: "user-1" } }, select: { id: true } });
		expect(transaction.prisma.verifiedFleetMembershipRevision.findFirst).not.toHaveBeenCalled();
		expect(transaction.prisma.authorizationGrant.findMany).not.toHaveBeenCalled();
	});

	it("fails closed when the signed silo membership belongs to another subject", async function _deniesForeignPersonalAssertion()
	{
		const transaction = _Transaction(_Revision([{ assertionId: "assertion-foreign", siloId: "silo-1", subjectId: "user-other" }]));
		await expect(_Source().load(_Command(), _Run(), transaction)).resolves.toEqual({ outcome: "denied", reason: "membership_stale" });
		expect(transaction.prisma.authorizationGrant.findMany).not.toHaveBeenCalled();
	});

	it("fails closed when the latest membership contains ambiguous personal entitlement", async function _deniesAmbiguousPersonalAssertion()
	{
		const transaction = _Transaction(_Revision([
			{ assertionId: "assertion-1", siloId: "silo-1", subjectId: "user-1" },
			{ assertionId: "assertion-2", siloId: "silo-1", subjectId: "user-1" },
		]));
		await expect(_Source().load(_Command(), _Run(), transaction)).resolves.toEqual({ outcome: "denied", reason: "membership_stale" });
		expect(transaction.prisma.authorizationGrant.findMany).not.toHaveBeenCalled();
	});

	it("fails closed when a silo-membership signature is older than the configured trust window", async function _deniesStaleMembership()
	{
		const transaction = _Transaction({ ..._Revision(), issuedAt: new Date(1000) });
		await expect(_Source().load(_Command(), _Run(), transaction)).resolves.toEqual({ outcome: "denied", reason: "membership_stale" });
		expect(transaction.prisma.authorizationGrant.findMany).not.toHaveBeenCalled();
	});
});
