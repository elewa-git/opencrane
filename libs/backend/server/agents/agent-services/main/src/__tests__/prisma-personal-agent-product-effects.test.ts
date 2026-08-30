import type { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import type { AuthorizationAuthority, ManagedAuthorizationGrantRepository } from "@opencrane/backend/server/iam/authorization";
import { AuthorizationDecisionOutcomes, AuthorizationSubjectKinds, ProductAuthorizationActions, ProductAuthorizationResourceKinds } from "@opencrane/models/authorization";

import { PersonalAgentSelectedResourceKinds } from "../personal-agent-product-effects.types";
import { PrismaPersonalAgentProductEffectsAuthority } from "../prisma-personal-agent-product-effects";

/** Trusted personal owner used by product-effect tests. */
const _CALLER = { siloId: "silo-1", subjectId: "user-1", principalId: "principal-1" } as const;

/** Current personal resources used by grant and admission assertions. */
const _RESOURCES = { agentServiceId: "service-1", agentRevisionId: "revision-2", personaProfileId: "profile-1", modelDefinitionId: "model-1" } as const;

/** Builds central-authority and managed-grant spies with an allowed decision by default. */
function _Dependencies(outcome: AuthorizationDecisionOutcomes = AuthorizationDecisionOutcomes.Allow)
{
	const authorization = { admitPrincipal: vi.fn().mockResolvedValue({ outcome, evidence: outcome === AuthorizationDecisionOutcomes.Allow ? { decisionDigest: "sha256:decision" } : null }) } as unknown as AuthorizationAuthority;
	const managedGrants = { reconcileManagedResourceGrants: vi.fn().mockResolvedValue(1) } as unknown as ManagedAuthorizationGrantRepository;
	const transaction = { principal: { findMany: vi.fn().mockResolvedValue([{ id: _CALLER.principalId, subject: _CALLER.subjectId }]) } } as unknown as Prisma.TransactionClient;
	return { authorization, managedGrants, transaction };
}

describe("PrismaPersonalAgentProductEffectsAuthority", function _ProductEffectsSuite()
{
	it("resolves a trusted subject to exactly one local Principal", async function _ResolvesCaller()
	{
		const dependencies = _Dependencies();
		const effects = new PrismaPersonalAgentProductEffectsAuthority(dependencies.transaction, dependencies.authorization, dependencies.managedGrants);

		await expect(effects.resolveCaller(_CALLER.siloId, _CALLER.subjectId)).resolves.toEqual(_CALLER);
	});

	it("uses the collection root before projecting exact initial publication grants", async function _AdmitsInitialPublication()
	{
		const dependencies = _Dependencies();
		const effects = new PrismaPersonalAgentProductEffectsAuthority(dependencies.transaction, dependencies.authorization, dependencies.managedGrants);

		const command = { caller: _CALLER, ..._RESOURCES, now: new Date("2026-08-29T08:00:00.000Z"), argumentsValue: { onboardingId: "onboarding-1" } };
		await effects.admitInitialCreation(command);
		expect(dependencies.managedGrants.reconcileManagedResourceGrants).not.toHaveBeenCalled();
		expect(dependencies.authorization.admitPrincipal).toHaveBeenCalledWith(expect.objectContaining({ resource: { kind: ProductAuthorizationResourceKinds.AgentServiceCollection, id: _CALLER.siloId }, action: ProductAuthorizationActions.Create }));

		await effects.admitInitialPublication(command);

		expect(dependencies.managedGrants.reconcileManagedResourceGrants).toHaveBeenCalledTimes(4);
		expect(dependencies.authorization.admitPrincipal).toHaveBeenCalledTimes(6);
		expect(dependencies.authorization.admitPrincipal).toHaveBeenCalledWith(expect.objectContaining({ resource: { kind: ProductAuthorizationResourceKinds.AgentRevision, id: _RESOURCES.agentRevisionId }, action: ProductAuthorizationActions.Publish }));
		expect(dependencies.authorization.admitPrincipal).toHaveBeenCalledWith(expect.objectContaining({ resource: { kind: ProductAuthorizationResourceKinds.Persona, id: _RESOURCES.personaProfileId }, action: ProductAuthorizationActions.Use }));
		expect(dependencies.authorization.admitPrincipal).toHaveBeenCalledWith(expect.objectContaining({ resource: { kind: ProductAuthorizationResourceKinds.ModelDefinition, id: _RESOURCES.modelDefinitionId }, action: ProductAuthorizationActions.Use }));
	});

	it("throws on a central denial so the caller rolls back projected grants", async function _RollsBackDenial()
	{
		const dependencies = _Dependencies(AuthorizationDecisionOutcomes.Deny);
		const effects = new PrismaPersonalAgentProductEffectsAuthority(dependencies.transaction, dependencies.authorization, dependencies.managedGrants);

		await expect(effects.admitRevisionSelection({ caller: _CALLER, source: _RESOURCES, target: { ..._RESOURCES, agentRevisionId: "revision-3", modelDefinitionId: "model-2" }, now: new Date("2026-08-29T08:00:00.000Z"), selectedResource: PersonalAgentSelectedResourceKinds.Model, argumentsValue: { modelAlias: "careful-model" } })).rejects.toThrow("not authorized");
	});

	it("keeps two personal owners isolated when their revisions share one ModelDefinition", async function _IsolatesSharedModel()
	{
		// 1. Use distinct owners with one shared model so the test reproduces the former manager collision.
		const dependencies = _Dependencies();
		const effects = new PrismaPersonalAgentProductEffectsAuthority(dependencies.transaction, dependencies.authorization, dependencies.managedGrants);
		const secondCaller = { siloId: _CALLER.siloId, subjectId: "user-2", principalId: "principal-2" } as const;
		const secondResources = { agentServiceId: "service-2", agentRevisionId: "revision-3", personaProfileId: "profile-2", modelDefinitionId: _RESOURCES.modelDefinitionId } as const;
		const now = new Date("2026-08-29T08:00:00.000Z");

		// 2. Reconcile both owners so each must retain an independent desired set for the shared model.
		await effects.reconcileCurrent(_CALLER, _RESOURCES, now);
		await effects.reconcileCurrent(secondCaller, secondResources, now);

		// 3. Verify each shared-model write uses a Principal-scoped manager and subject.
		const modelCalls = vi.mocked(dependencies.managedGrants.reconcileManagedResourceGrants).mock.calls.map(call => call[0]).filter(command => command.resource.kind === ProductAuthorizationResourceKinds.ModelDefinition);
		expect(modelCalls).toEqual([
			expect.objectContaining({ managerId: "personal-agent-owner-access:principal-1", resource: { kind: ProductAuthorizationResourceKinds.ModelDefinition, id: _RESOURCES.modelDefinitionId }, grants: expect.arrayContaining([expect.objectContaining({ subject: { kind: AuthorizationSubjectKinds.Principal, principalId: "principal-1" } })]) }),
			expect.objectContaining({ managerId: "personal-agent-owner-access:principal-2", resource: { kind: ProductAuthorizationResourceKinds.ModelDefinition, id: _RESOURCES.modelDefinitionId }, grants: expect.arrayContaining([expect.objectContaining({ subject: { kind: AuthorizationSubjectKinds.Principal, principalId: "principal-2" } })]) }),
		]);
	});
});
