import { AgentServiceKind, AgentServiceState, PrincipalProvenance } from "@prisma/client";
import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AgentIdentityHistory } from "@opencrane/backend/server/iam/identity";
import { PrismaAuthorizationAuthority, PrismaManagedAuthorizationGrantRepository } from "@opencrane/backend/server/iam/authorization";
import { AgentIdentityKinds, AgentIdentityStates, PROMPT_COMPILER_VERSION } from "@opencrane/contracts";
import { AuthorizationBoundaryCoverages, AuthorizationBoundaryKinds, AuthorizationDecisionOutcomes, AuthorizationSubjectKinds, ProductAuthorizationActions, ProductAuthorizationResourceKinds } from "@opencrane/models/authorization";

import { _CreateCompanyAssistantComposition } from "../company-assistant-composition";
import { __CompanyAssistantServiceId, __ManagedAgentIdentityId } from "../managed-agent-identity";

/** Keeps the creation and retry assertions independent of the production default. */
const _MULTI_STEP_BUDGET = { maxTurns: 9, maxTokens: 32_000, maxCostUsdMicros: null, maxToolInvocations: 8, maxDurationMs: 120_000, maxLoopIterations: 8 };
/** Represents an assistant provisioned before repeated company tool work was enabled. */
const _LEGACY_BUDGET = { maxTurns: 2, maxTokens: 32_000, maxCostUsdMicros: null, maxToolInvocations: 1, maxDurationMs: 120_000, maxLoopIterations: 1 };
/** Uses the real composition and transaction owner while isolating persistence and identity history. */
function _fixture()
{
	const admitPrincipal = vi.spyOn(PrismaAuthorizationAuthority.prototype, "admitPrincipal").mockResolvedValue({ outcome: AuthorizationDecisionOutcomes.Allow, evidence: { decisionDigest: "sha256:allowed" } } as never);
	const reconcileGrants = vi.spyOn(PrismaManagedAuthorizationGrantRepository.prototype, "reconcileManagedResourceGrants").mockResolvedValue(1);
	const loadIdentity = vi.spyOn(AgentIdentityHistory.prototype, "load").mockResolvedValue(null);
	const loadActiveIdentity = vi.spyOn(AgentIdentityHistory.prototype, "loadActive").mockResolvedValue({ identity: { kind: AgentIdentityKinds.Managed } } as never);
	let committed = false;
	const appendIdentity = vi.spyOn(AgentIdentityHistory.prototype, "append").mockImplementation(async function _AfterCommit()
	{
		expect(committed).toBe(true);
		return {} as never;
	});
	const transaction = {
		principal: { findMany: vi.fn().mockResolvedValue([{ id: "admin", subject: "admin-subject" }]), create: vi.fn().mockResolvedValue({}) },
		orgMembership: { findMany: vi.fn().mockResolvedValue([{ subject: "admin-subject" }]) },
		agentService: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({}), update: vi.fn().mockResolvedValue({}) },
		agentRevision: { create: vi.fn().mockResolvedValue({}), update: vi.fn().mockResolvedValue({}) },
	};
	const prisma = { $transaction: vi.fn().mockImplementation(async function _Commit(operation)
	{
		const result = await operation(transaction);
		committed = true;
		return result;
	}) };
	const app = express();
	app.use(express.json());
	app.use(function _Authenticated(request, _response, next)
	{
		request.session = { authUser: { authenticatedAt: new Date().toISOString() } } as never;
		request.authenticatedPrincipal = { principalId: "admin", siloId: "acme", issuer: "https://identity.example", subject: "admin-subject" };
		next();
	});
	app.use(_CreateCompanyAssistantComposition(prisma as never, {} as never, { profileName: "company-test-profile" }, { warn: vi.fn() } as never));
	return { app, transaction, admitPrincipal, reconcileGrants, loadIdentity, loadActiveIdentity, appendIdentity };
}

/** Restores the isolated database/history ports after the real route and publication composition runs. */
afterEach(function _Restore() { vi.restoreAllMocks(); });

describe("company assistant application composition", function _Suite()
{
	it("publishes a fresh eight-tool revision with a final model turn and unchanged total token and time ceilings", async function _PublishesToolCapableBudget()
	{
		const f = _fixture();
		const response = await request(f.app).post("/").set("Host", "acme.opencrane.test").send({ name: "Company assistant", modelDefinitionId: "model-1", invokerPrincipalIds: ["admin"] }).expect(201);
		expect(response.body.created).toBe(true);
		expect(f.transaction.agentRevision.create).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ data: expect.objectContaining({ budget: _MULTI_STEP_BUDGET, promptPolicyVersion: PROMPT_COMPILER_VERSION, personaRevisionId: null, skillAssignments: { create: [] }, mcpToolAssignments: { create: [] }, boundaryAttachments: { create: [] } }) }));
		const principalId = f.transaction.principal.create.mock.calls[0][0].data.id;
		const serviceId = __CompanyAssistantServiceId("acme");
		expect(principalId).not.toBe("admin");
		expect(f.transaction.principal.create).toHaveBeenCalledExactlyOnceWith({ data: { id: principalId, siloId: "acme", issuer: "urn:opencrane:agent-service", subject: serviceId, provenance: PrincipalProvenance.Internal, email: null, displayName: "Company assistant", createdAt: expect.any(Date) } });
		expect(f.transaction.agentService.create).toHaveBeenCalledExactlyOnceWith({ data: { id: serviceId, siloId: "acme", kind: AgentServiceKind.Managed, name: "Company assistant", principalId, workloadProfile: "company-test-profile", state: AgentServiceState.Draft, createdAt: expect.any(Date) } });
		expect(f.admitPrincipal.mock.calls.map(call => [call[0].resource, call[0].action])).toEqual([
			[{ kind: ProductAuthorizationResourceKinds.Organization, id: "acme" }, ProductAuthorizationActions.Administer],
			[{ kind: ProductAuthorizationResourceKinds.ModelDefinition, id: "model-1" }, ProductAuthorizationActions.Use],
		]);
		expect(f.reconcileGrants.mock.calls.map(call => call[0].grants)).toEqual([
			["agent-service:discover", "agent-service:read", "agent-service:invoke"].map(capabilityId => expect.objectContaining({ subject: { kind: AuthorizationSubjectKinds.Principal, principalId: "admin" }, boundary: { kind: AuthorizationBoundaryKinds.Personal, principalId: "admin" }, boundaryCoverage: AuthorizationBoundaryCoverages.Exact, capability: expect.objectContaining({ capabilityId }), resource: { kind: ProductAuthorizationResourceKinds.AgentService, id: serviceId } })),
			[expect.objectContaining({ subject: { kind: AuthorizationSubjectKinds.Principal, principalId }, boundary: { kind: AuthorizationBoundaryKinds.Personal, principalId }, boundaryCoverage: AuthorizationBoundaryCoverages.Exact, capability: expect.objectContaining({ capabilityId: "model-definition:use" }), resource: { kind: ProductAuthorizationResourceKinds.ModelDefinition, id: "model-1" } })],
		]);
		expect(f.appendIdentity).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ identity: { schemaVersion: 1, kind: AgentIdentityKinds.Managed, id: __ManagedAgentIdentityId(serviceId), siloId: "acme", agentServiceId: serviceId, principalId, name: "Company assistant", avatarArtifactRevisionId: null, state: AgentIdentityStates.Active, createdByPrincipalId: "admin", createdAt: expect.any(String) } }));
	});

	it.each([_LEGACY_BUDGET, _MULTI_STEP_BUDGET])("returns an existing assistant without replacing its saved budget %j or restoring grants", async function _PreservesExistingBudget(budget)
	{
		const f = _fixture();
		const existing = { kind: AgentServiceKind.Managed, state: AgentServiceState.Active, activeRevisionId: "revision-current", principal: { id: "company-principal", provenance: PrincipalProvenance.Internal }, revisions: [{ id: "revision-first", authoredBy: "original-admin", budget }], name: "Original company assistant", workloadProfile: "original-profile", createdAt: new Date("2026-09-07T10:00:00.000Z") };
		const original = structuredClone(existing);
		f.transaction.agentService.findFirst.mockResolvedValue(existing);
		f.loadIdentity.mockResolvedValue({ identity: { kind: AgentIdentityKinds.Managed } } as never);

		const response = await request(f.app).post("/").set("Host", "acme.opencrane.test").send({ name: "Replacement ignored", modelDefinitionId: "replacement-model", invokerPrincipalIds: ["different-human"] }).expect(200);

		expect(response.body).toEqual({ created: false, assistant: { agentServiceId: __CompanyAssistantServiceId("acme"), displayName: existing.name } });
		expect(existing).toEqual(original);
		expect(f.admitPrincipal.mock.calls.map(call => call[0].action)).toEqual([ProductAuthorizationActions.Administer]);
		expect(f.transaction.principal.create).not.toHaveBeenCalled();
		expect(f.transaction.agentService.create).not.toHaveBeenCalled();
		expect(f.transaction.agentService.update).not.toHaveBeenCalled();
		expect(f.transaction.agentRevision.create).not.toHaveBeenCalled();
		expect(f.transaction.agentRevision.update).not.toHaveBeenCalled();
		expect(f.reconcileGrants).not.toHaveBeenCalled();
		expect(f.appendIdentity).not.toHaveBeenCalled();
		expect(f.loadActiveIdentity).toHaveBeenCalledExactlyOnceWith({ siloId: "acme", agentIdentityId: __ManagedAgentIdentityId(__CompanyAssistantServiceId("acme")), agentServiceId: __CompanyAssistantServiceId("acme"), principalId: "company-principal" });
	});
});
