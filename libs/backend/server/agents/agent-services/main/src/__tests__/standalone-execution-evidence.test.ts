import { AgentRevisionState, AuditDecisionActorKind, OrgMemberStatus, PrincipalProvenance, type Prisma } from "@prisma/client";
import { AgentIdentityStates } from "@opencrane/contracts";
import { PrismaAuthorizationAuthority } from "@opencrane/backend/server/iam/authorization";
import { FleetMembershipDeploymentModes, __DigestHumanMembershipEvidence } from "@opencrane/backend/server/iam/membership";
import { ExecutionSubjectMembershipKinds } from "@opencrane/models/agents";
import { ProductAuthorizationActions, ProductAuthorizationResourceKinds, __ProductAuthorizationCapability } from "@opencrane/models/authorization";
import { describe, expect, it, vi } from "vitest";

import { PrismaManagedAgentConversationResolver } from "../db/prisma-managed-agent-conversation-resolver";
import { PrismaManagedExecutionEvidenceRepository } from "../db/prisma-managed-execution-evidence-repository";
import { PrismaPersonalExecutionEvidenceRepository } from "../db/prisma-personal-execution-evidence-repository";
import { ManagedExecutionEvidenceAuthority } from "../managed-execution-evidence";
import { PersonalExecutionEvidenceAuthority } from "../personal-execution-evidence";
import { __CompanyAssistantServiceId } from "../managed-agent-identity";

/** Runs local membership and central grant/audit code against separate human and company rows. */
function _Fixture()
{
	const serviceId = __CompanyAssistantServiceId("silo-1");
	const principal = { id: "human-1", siloId: "silo-1", issuer: "https://issuer.example", subject: "oidc-human", provenance: PrincipalProvenance.External };
	const membership = { id: "local-1", clusterTenant: "silo-1", subject: "oidc-human", status: OrgMemberStatus.Active, updatedAt: new Date(1_000) };
	const revision = { id: "revision-1", siloId: "silo-1", agentServiceId: serviceId, state: AgentRevisionState.Published, digest: `sha256:${"a".repeat(64)}`, personaRevisionId: null, modelDefinitionId: "model-1", budget: { maxDurationMs: 60_000 }, skillAssignments: [], mcpToolAssignments: [], boundaryAttachments: [] };
	const grants = [ProductAuthorizationActions.Invoke, ProductAuthorizationActions.Use, ProductAuthorizationActions.Discover, ProductAuthorizationActions.Read].map(function _Grant(action)
	{
		const principalId = action === ProductAuthorizationActions.Use ? "company-1" : "human-1";
		const resourceKind = action === ProductAuthorizationActions.Use ? ProductAuthorizationResourceKinds.ModelDefinition : ProductAuthorizationResourceKinds.AgentService;
		const resourceId = action === ProductAuthorizationActions.Use ? "model-1" : serviceId;
		const capability = __ProductAuthorizationCapability(resourceKind, action)!;
		return { id: `grant-${action}`, siloId: "silo-1", subjectKind: "Principal", subjectPrincipalId: principalId, subjectGroupId: null, boundaryKind: "Personal", boundaryPrincipalId: principalId, boundaryGroupId: null, boundaryCoverage: "Exact", catalogId: capability.catalog.catalogId, catalogRevision: capability.catalog.revision, catalogDigest: capability.catalog.digest, capabilityId: capability.capabilityId, resourceKind, resourceId, effect: "Allow", priority: 0, validFrom: new Date(0), expiresAt: null, revokedAt: null };
	});
	const transaction = {
		principal: { findFirst: vi.fn().mockResolvedValue(principal), findUnique: vi.fn(async function _Principal(query: { where: { id_siloId: { id: string } } }) { const id = query.where.id_siloId.id; return id === "human-1" ? principal : { id, subject: id, provenance: PrincipalProvenance.Internal }; }) },
		orgMembership: { findUnique: vi.fn().mockResolvedValue(membership), findFirst: vi.fn().mockResolvedValue(membership) },
		groupMembership: { findMany: vi.fn().mockResolvedValue([]) },
		authorizationGrant: { findMany: vi.fn().mockResolvedValue(grants) },
		auditDecision: { create: vi.fn(async function _Persist(_command: { data: Prisma.AuditDecisionUncheckedCreateInput }) { return {}; }) },
		agentRevision: { findFirst: vi.fn().mockResolvedValue(revision) },
		agentService: { findFirst: vi.fn().mockResolvedValue({ id: serviceId, principalId: "company-1", name: "Company", workloadProfile: "developer", activeRevisionId: revision.id, activeRevision: revision }) },
		verifiedFleetMembershipRevision: { findFirst: vi.fn() },
	};
	const config = { mode: FleetMembershipDeploymentModes.Standalone, siloId: "silo-1", trustedOidcIssuer: principal.issuer, maximumStalenessMs: 5_000 } as const;
	const baseIdentity = { schemaVersion: 1, id: "identity-1", siloId: "silo-1", agentServiceId: serviceId, name: "Assistant", avatarArtifactRevisionId: null, state: AgentIdentityStates.Active, createdByPrincipalId: "human-1", createdAt: new Date(1_000).toISOString() } as const;
	const humanIdentity = { ...baseIdentity, kind: "proxied", proxiedPrincipalId: "human-1", delegationPolicyId: "policy-1" } as const;
	const companyIdentity = { ...baseIdentity, kind: "managed", principalId: "company-1" } as const;
	const runTransaction = { authorization: new PrismaAuthorizationAuthority(transaction as never), admittedAtEpochMs: 2_000 };
	const personal = new PersonalExecutionEvidenceAuthority(new PrismaPersonalExecutionEvidenceRepository(transaction as never, config));
	const managed = new ManagedExecutionEvidenceAuthority(new PrismaManagedExecutionEvidenceRepository(transaction as never, config));
	const resolver = new PrismaManagedAgentConversationResolver(transaction as never, { membershipConfig: config, profiles: [{ workloadProfile: "developer", profileRevisionId: "profile-1" }], identityHistory: { load: vi.fn().mockResolvedValue({ identity: companyIdentity }) }, nowEpochMs: function _Now() { return 2_000; } });
	return { serviceId, principal, membership, grants, transaction, humanIdentity, companyIdentity, runTransaction, personal, managed, resolver };
}

describe("standalone execution through IAM and the central recorder", function _Suite()
{
	it("admits a personal run with local membership and no made-up audit revision", async function _Personal()
	{
		const f = _Fixture();
		const result = await f.personal.load({ identity: f.humanIdentity, requesterPrincipalId: "human-1", agentRevisionId: "revision-1" }, f.runTransaction);
		expect(result.outcome).toBe("loaded");
		if (result.outcome !== "loaded")
			throw new Error("Expected local execution evidence");
		expect(result.value.membership).toMatchObject({ kind: ExecutionSubjectMembershipKinds.Standalone, principalId: "human-1", membershipId: "local-1", trustedUntil: new Date(7_000).toISOString() });
		expect(__DigestHumanMembershipEvidence(result.value.membership)).toMatch(/^sha256:[a-f0-9]{64}$/);
		expect(f.transaction.auditDecision.create.mock.calls[0]?.[0].data).toMatchObject({ actorKind: AuditDecisionActorKind.User, actorId: "human-1", action: ProductAuthorizationActions.Invoke, membershipRevision: undefined });
		expect(f.transaction.verifiedFleetMembershipRevision.findFirst).not.toHaveBeenCalled();
	});

	it("lists without admissions and records separate human and company actors for child creation", async function _DirectoryAndChild()
	{
		const f = _Fixture();
		await expect(f.resolver.list({ siloId: "silo-1", principalId: "human-1" })).resolves.toHaveLength(1);
		expect(f.transaction.auditDecision.create).not.toHaveBeenCalled();
		await expect(f.resolver.resolve({ siloId: "silo-1", principalId: "human-1" }, f.serviceId)).resolves.toMatchObject({ principalId: "company-1" });
		expect(f.transaction.auditDecision.create.mock.calls.map(call => call[0].data)).toEqual([
			expect.objectContaining({ actorKind: AuditDecisionActorKind.User, actorId: "human-1", action: ProductAuthorizationActions.Invoke, membershipRevision: undefined }),
			expect.objectContaining({ actorKind: AuditDecisionActorKind.AgentService, actorId: "company-1", action: ProductAuthorizationActions.Use, membershipRevision: undefined }),
		]);
	});

	it("keeps company execution evidence separate and bounded by the local human deadline", async function _Managed()
	{
		const f = _Fixture();
		await expect(f.managed.load({ identity: f.companyIdentity, requesterPrincipalId: "human-1", agentRevisionId: "revision-1" }, f.runTransaction)).resolves.toMatchObject({ outcome: "loaded", value: { membership: { kind: ExecutionSubjectMembershipKinds.Managed, principalId: "company-1", trustedUntil: new Date(7_000).toISOString() }, requesterMembership: { kind: ExecutionSubjectMembershipKinds.Standalone, principalId: "human-1", membershipId: "local-1" } } });
	});

	it("cannot borrow human model permissions for the company", async function _OwnGrants()
	{
		const f = _Fixture();
		f.transaction.authorizationGrant.findMany.mockResolvedValue(f.grants.map(grant => grant.resourceKind === ProductAuthorizationResourceKinds.ModelDefinition ? { ...grant, subjectPrincipalId: "human-1", boundaryPrincipalId: "human-1" } : grant));
		await expect(f.managed.load({ identity: f.companyIdentity, requesterPrincipalId: "human-1", agentRevisionId: "revision-1" }, f.runTransaction)).resolves.toMatchObject({ outcome: "denied", reason: "product_authorization_unavailable" });
		await expect(f.resolver.list({ siloId: "silo-1", principalId: "human-1" })).resolves.toEqual([]);
	});

	it("stops personal, company and directory paths before admission when local membership is suspended", async function _Revoked()
	{
		const f = _Fixture();
		f.transaction.orgMembership.findUnique.mockResolvedValue({ ...f.membership, status: OrgMemberStatus.Suspended });
		await expect(f.personal.load({ identity: f.humanIdentity, requesterPrincipalId: "human-1", agentRevisionId: "revision-1" }, f.runTransaction)).resolves.toMatchObject({ outcome: "denied", reason: "membership_stale" });
		await expect(f.managed.load({ identity: f.companyIdentity, requesterPrincipalId: "human-1", agentRevisionId: "revision-1" }, f.runTransaction)).resolves.toMatchObject({ outcome: "denied", reason: "membership_stale" });
		await expect(f.resolver.list({ siloId: "silo-1", principalId: "human-1" })).resolves.toEqual([]);
		expect(f.transaction.auditDecision.create).not.toHaveBeenCalled();
	});
});
