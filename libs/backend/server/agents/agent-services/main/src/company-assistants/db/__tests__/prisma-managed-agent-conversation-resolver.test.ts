import { AuditDecisionActorKind, type Prisma } from "@prisma/client";
import { PrismaAuthorizationAuthority } from "@opencrane/backend/server/iam/authorization";
import { AgentIdentityStates } from "@opencrane/contracts";
import { ProductAuthorizationActions, ProductAuthorizationResourceKinds, __ProductAuthorizationCapability } from "@opencrane/models/authorization";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PrismaManagedAgentConversationResolver } from "../prisma-managed-agent-conversation-resolver";
import { PrismaManagedExecutionEvidenceRepository } from "../../../execution-evidence/db/prisma-managed-execution-evidence-repository";
import { __CompanyAssistantServiceId, __ManagedAgentIdentityId } from "../../managed-agent-identity";
import { ManagedExecutionEvidenceAuthority } from "../../../execution-evidence/managed-execution-evidence";

const _SERVICE = __CompanyAssistantServiceId("silo-1");
const _CALLER = { siloId: "silo-1", principalId: "human-1" };

afterEach(function _Restore() { vi.restoreAllMocks(); });

/** Supplies separate current service, identity, human assertion and grant authorities. */
function _Fixture()
{
	vi.spyOn(PrismaManagedExecutionEvidenceRepository.prototype, "loadCurrent").mockResolvedValue({ agentServiceId: _SERVICE, agentRevisionId: "revision-1", agentRevisionDigest: "sha256:revision", principalId: "company-principal", name: "Company", workloadProfile: "company", modelDefinitionId: "model-1", budget: { maxDurationMs: 60_000 } });
	const membership = vi.spyOn(PrismaManagedExecutionEvidenceRepository.prototype, "verifyRequesterMembership").mockResolvedValue({ kind: "fleet", revision: 7 } as never);
	const admit = vi.spyOn(PrismaAuthorizationAuthority.prototype, "admitPrincipal");
	const decide = vi.spyOn(PrismaAuthorizationAuthority.prototype, "decidePrincipal");
	const grants = [ProductAuthorizationActions.Invoke, ProductAuthorizationActions.Use, ProductAuthorizationActions.Discover, ProductAuthorizationActions.Read].map(function _Grant(action)
	{
		const principalId = action === ProductAuthorizationActions.Use ? "company-principal" : "human-1";
		const resourceKind = action === ProductAuthorizationActions.Use ? ProductAuthorizationResourceKinds.ModelDefinition : ProductAuthorizationResourceKinds.AgentService;
		const resourceId = action === ProductAuthorizationActions.Use ? "model-1" : _SERVICE;
		const capability = __ProductAuthorizationCapability(resourceKind, action)!;
		return { id: `grant-${action}`, siloId: "silo-1", subjectKind: "Principal", subjectPrincipalId: principalId, subjectGroupId: null, boundaryKind: "Personal", boundaryPrincipalId: principalId, boundaryGroupId: null, boundaryCoverage: "Exact", catalogId: capability.catalog.catalogId, catalogRevision: capability.catalog.revision, catalogDigest: capability.catalog.digest, capabilityId: capability.capabilityId, resourceKind, resourceId, effect: "Allow", priority: 0, validFrom: new Date(0), expiresAt: null, revokedAt: null };
	});
	const transaction = {
		principal: { findUnique: vi.fn(async function _Principal(query: { where: { id_siloId: { id: string } } }) { const id = query.where.id_siloId.id; return { id, subject: id, provenance: id === "human-1" ? "External" : "Internal" }; }) },
		orgMembership: { findFirst: vi.fn().mockResolvedValue({ id: "membership-1" }) },
		groupMembership: { findMany: vi.fn().mockResolvedValue([]) },
		authorizationGrant: { findMany: vi.fn().mockResolvedValue(grants) },
		auditDecision: { create: vi.fn(async function _Persist(_command: { data: Prisma.AuditDecisionUncheckedCreateInput }) { return {}; }) },
	};
	const identityHistory = { load: vi.fn().mockResolvedValue({ identity: { kind: "managed", state: AgentIdentityStates.Active } }) };
	const dependencies = { identityHistory, membershipConfig: {} as never, profiles: [{ workloadProfile: "company", profileRevisionId: "profile-1" }], nowEpochMs: function _Now() { return 2_000; } };
	return { admit, decide, grants, transaction, membership, identityHistory, dependencies, resolver: new PrismaManagedAgentConversationResolver(transaction as never, dependencies) };
}

describe("PrismaManagedAgentConversationResolver", function _Suite()
{
	it("propagates history outages so admitted child work can retry", async function _HistoryOutage()
	{
		const f = _Fixture();
		const failure = new Error("history transport unavailable");
		f.identityHistory.load.mockRejectedValue(failure);
		await expect(f.resolver.resolve(_CALLER, _SERVICE)).rejects.toBe(failure);
	});

	it("lists only the fixed ready company identity through human discovery and own model authority", async function _Lists()
	{
		const f = _Fixture();
		await expect(f.resolver.list(_CALLER)).resolves.toEqual([{ agentServiceId: _SERVICE, agentRevisionId: "revision-1", agentIdentityId: __ManagedAgentIdentityId(_SERVICE), principalId: "company-principal", name: "Company", workloadProfile: "company", profileRevisionId: "profile-1" }]);
		expect(f.transaction.auditDecision.create).not.toHaveBeenCalled();
		expect(f.admit).not.toHaveBeenCalled();
		expect(f.decide.mock.calls.map(call => [call[0].principalId, call[0].action])).toEqual([["human-1", ProductAuthorizationActions.Invoke], ["company-principal", ProductAuthorizationActions.Use], ["human-1", ProductAuthorizationActions.Discover], ["human-1", ProductAuthorizationActions.Read]]);
	});

	it.each([ProductAuthorizationActions.Invoke, ProductAuthorizationActions.Use, ProductAuthorizationActions.Discover, ProductAuthorizationActions.Read])("hides the assistant when current %s permission is missing", async function _Denies(action)
	{
		const f = _Fixture();
		f.transaction.authorizationGrant.findMany.mockResolvedValue(f.grants.filter(grant => grant.id !== `grant-${action}`));
		await expect(f.resolver.list(_CALLER)).resolves.toEqual([]);
	});

	it("keeps recorded human Invoke and company Model Use admission for child creation", async function _CreationAdmissions()
	{
		const f = _Fixture();
		await expect(f.resolver.resolve(_CALLER, _SERVICE)).resolves.toMatchObject({ agentServiceId: _SERVICE });
		expect(f.admit.mock.calls.map(call => [call[0].principalId, call[0].action])).toEqual([["human-1", ProductAuthorizationActions.Invoke], ["company-principal", ProductAuthorizationActions.Use]]);
		expect(f.transaction.auditDecision.create).toHaveBeenCalledTimes(2);
		expect(f.transaction.auditDecision.create.mock.calls.map(call => call[0].data)).toEqual([
			expect.objectContaining({ actorKind: AuditDecisionActorKind.User, actorId: "human-1", action: ProductAuthorizationActions.Invoke, membershipRevision: 7 }),
			expect.objectContaining({ actorKind: AuditDecisionActorKind.AgentService, actorId: "company-principal", action: ProductAuthorizationActions.Use, resourceKind: ProductAuthorizationResourceKinds.ModelDefinition, membershipRevision: undefined, podUid: undefined }),
	]);
		expect(f.decide).not.toHaveBeenCalled();
	});

	it("does not select an ambiguous profile or a revoked company identity", async function _RejectsReadiness()
	{
		const f = _Fixture();
		const ambiguous = new PrismaManagedAgentConversationResolver({} as never, { ...f.dependencies, profiles: [...f.dependencies.profiles, ...f.dependencies.profiles] });
		await expect(ambiguous.resolve(_CALLER, _SERVICE)).resolves.toBeNull();
		expect(f.admit).not.toHaveBeenCalled();
		f.identityHistory.load.mockResolvedValue({ identity: { kind: "managed", state: AgentIdentityStates.Suspended } });
		await expect(f.resolver.resolve(_CALLER, _SERVICE)).resolves.toBeNull();
		expect(f.admit).not.toHaveBeenCalled();
	});

	it("requires the human's own current signed membership", async function _RejectsRevokedHuman()
	{
		const f = _Fixture();
		f.membership.mockResolvedValue(null);
		await expect(f.resolver.resolve(_CALLER, _SERVICE)).resolves.toBeNull();
		expect(f.admit).not.toHaveBeenCalled();
	});
});

describe("managed run admission through the central audit writer", function _Suite()
{
	/** Shares the resolver's real policy and recorder fixture with the adjacent run-evidence authority. */
	function _RunFixture()
	{
		const f = _Fixture();
		const revision = { agentServiceId: _SERVICE, agentRevisionId: "revision-1", agentRevisionDigest: `sha256:${"a".repeat(64)}`, principalId: "company-principal", name: "Company", workloadProfile: "company", modelDefinitionId: "model-1", budget: { maxDurationMs: 60_000 } };
		const human = { kind: "fleet", principalId: "human-1", siloId: "silo-1", decisionEvidenceId: "human-assertion", revision: 7, assertionId: "human-assertion", payloadDigest: `sha256:${"b".repeat(64)}`, trustedUntil: new Date(6_000).toISOString() };
		const repository = { loadCurrent: vi.fn().mockResolvedValue(revision), verifyRequesterMembership: vi.fn().mockResolvedValue(human) };
		const command = { identity: { schemaVersion: 1, kind: "managed", id: __ManagedAgentIdentityId(_SERVICE), siloId: "silo-1", agentServiceId: _SERVICE, principalId: "company-principal", name: "Company", avatarArtifactRevisionId: null, state: AgentIdentityStates.Active, createdByPrincipalId: "human-1", createdAt: new Date(1_000).toISOString() } as const, requesterPrincipalId: "human-1", agentRevisionId: "revision-1" };
		const authority = new ManagedExecutionEvidenceAuthority(repository);
		const transaction = { authorization: new PrismaAuthorizationAuthority(f.transaction as never), admittedAtEpochMs: 2_000 };
		return { ...f, authority, command, runTransaction: transaction };
	}

	it("records the requesting human and executing company as separate actors before runtime starts", async function _RecordsExecutionPrincipal()
	{
		const f = _RunFixture();
		await expect(f.authority.load(f.command, f.runTransaction)).resolves.toMatchObject({ outcome: "loaded", value: { membership: { principalId: "company-principal", trustedUntil: new Date(6_000).toISOString() }, requesterMembership: { principalId: "human-1", revision: 7 } } });
		expect(f.transaction.auditDecision.create.mock.calls.map(call => call[0].data)).toEqual([
			expect.objectContaining({ actorKind: AuditDecisionActorKind.User, actorId: "human-1", action: ProductAuthorizationActions.Invoke, membershipRevision: 7 }),
			expect.objectContaining({ actorKind: AuditDecisionActorKind.AgentService, actorId: "company-principal", action: ProductAuthorizationActions.Use, membershipRevision: undefined, audience: undefined, namespace: undefined, serviceAccountName: undefined, workloadKind: undefined, workloadUid: undefined, podUid: undefined }),
		]);
	});

	it("does not replace company execution authority with the requesting human's model grant", async function _PreservesCompanyPrincipal()
	{
		const f = _RunFixture();
		f.transaction.authorizationGrant.findMany.mockResolvedValue(f.grants.map(grant => grant.resourceKind === ProductAuthorizationResourceKinds.ModelDefinition ? { ...grant, subjectPrincipalId: "human-1", boundaryPrincipalId: "human-1" } : grant));
		await expect(f.authority.load(f.command, f.runTransaction)).resolves.toMatchObject({ outcome: "denied", reason: "product_authorization_unavailable" });
		expect(f.transaction.auditDecision.create.mock.calls.map(call => call[0].data.action)).toEqual([ProductAuthorizationActions.Invoke]);
	});
});
