import { PrismaAuthorizationAuthority } from "@opencrane/backend/server/iam/authorization";
import { AgentIdentityStates } from "@opencrane/contracts";
import { ProductAuthorizationActions, ProductAuthorizationResourceKinds, __ProductAuthorizationCapability } from "@opencrane/models/authorization";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PrismaManagedAgentConversationResolver } from "../db/prisma-managed-agent-conversation-resolver";
import { PrismaManagedExecutionEvidenceRepository } from "../db/prisma-managed-execution-evidence-repository";
import { __CompanyAssistantServiceId, __ManagedAgentIdentityId } from "../managed-agent-identity";

const _SERVICE = __CompanyAssistantServiceId("silo-1");
const _CALLER = { siloId: "silo-1", principalId: "human-1" };

afterEach(function _Restore() { vi.restoreAllMocks(); });

/** Supplies separate current service, identity, human assertion and grant authorities. */
function _Fixture()
{
	vi.spyOn(PrismaManagedExecutionEvidenceRepository.prototype, "loadCurrent").mockResolvedValue({ agentServiceId: _SERVICE, agentRevisionId: "revision-1", agentRevisionDigest: "sha256:revision", principalId: "company-principal", name: "Company", workloadProfile: "company", modelDefinitionId: "model-1", budget: { maxDurationMs: 60_000 } });
	const membership = vi.spyOn(PrismaManagedExecutionEvidenceRepository.prototype, "verifyRequesterMembership").mockResolvedValue({ revision: 7 } as never);
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
		auditDecision: { create: vi.fn().mockResolvedValue({}) },
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
