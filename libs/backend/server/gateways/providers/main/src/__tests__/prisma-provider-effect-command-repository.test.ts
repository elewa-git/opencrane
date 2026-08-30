import { describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

import type { AuthorizationAuthority } from "@opencrane/backend/server/iam/authorization";
import { AuthorizationDecisionOutcomes, ProductAuthorizationResourceKinds } from "@opencrane/models/authorization";
import { ModelRoutingScope } from "@opencrane/contracts";
import { ProviderEmbeddingReconciliationStatuses } from "@opencrane/backend/server/gateways/model-routing";
import { ___DigestCanonicalJson, type JsonValue } from "@opencrane/util";

import { PrismaProviderEffectCommandRepository } from "../prisma-provider-effect-command-repository";
import { _PROVIDER_EFFECT_FINALIZATION_BLOCKED_FAILURE_CODE, _PROVIDER_EFFECT_OUTCOME_UNCERTAIN_FAILURE_CODE } from "../provider-effect-command-errors";
import { ProviderEffectAdmissionStatuses, ProviderEffectCommandKinds, ProviderEffectCommandStates, ProviderEffectExecutionStatuses, ProviderEffectMaterialRequirements, type ProviderEffectCommandPayload, type ProviderEffectCommandRecord, type ProviderEffectExecutionContext } from "../provider-effect-command.types";

/** Stable executor profile shared by current-authority repository tests. */
const _PROFILE = "opencrane-control-plane/provider-effect-v1";

/** Builds one current request or system delivery context. */
function _context(actorKind: "user" | "system" = "user"): ProviderEffectExecutionContext
{
	return { siloId: "acme", principalId: "principal-1", actorKind, actorId: actorKind === "user" ? "principal-1" : _PROFILE, resourceKind: ProductAuthorizationResourceKinds.ProviderConnection, resourceId: "byok:acme:openai", executorProfile: _PROFILE };
}

/** Builds one Prisma-shaped provider command row for repository tests. */
function _row(payload: ProviderEffectCommandPayload, overrides: Record<string, unknown> = {}): Record<string, unknown>
{
	return {
		id: "command-a",
		siloId: "acme",
		principalId: "principal-1",
		kind: payload.kind,
		resourceKind: payload.kind === ProviderEffectCommandKinds.RegisterModel ? ProductAuthorizationResourceKinds.ModelDefinition : ProductAuthorizationResourceKinds.ProviderConnection,
		resourceId: payload.kind === ProviderEffectCommandKinds.RegisterModel ? payload.value.modelDefinitionId : `byok:acme:${payload.value.provider}`,
		resourceRevision: "revision-a",
		desiredGeneration: 1,
		argumentsDigest: "sha256:arguments",
		materialVerifier: null,
		authorizationDecisionDigest: "sha256:decision",
		authorizationPolicyRevisionHash: "sha256:policy",
		effectiveAuthorizationDigest: "sha256:effective",
		executorProfile: _PROFILE,
		materialRequirement: ProviderEffectMaterialRequirements.None,
		payload: payload.value,
		state: ProviderEffectCommandStates.Pending,
		deliveryCount: 0,
		claimFence: null,
		claimExpiresAt: null,
		followUpCommandId: null,
		result: null,
		failureCode: null,
		createdAt: new Date("2026-08-30T00:00:00.000Z"),
		updatedAt: new Date("2026-08-30T00:00:00.000Z"),
		completedAt: null,
		...overrides,
	};
}

/** Converts a Prisma-shaped row into the claimed record passed between executor transactions. */
function _record(row: Record<string, unknown>, payload: ProviderEffectCommandPayload): ProviderEffectCommandRecord
{
	return { id: row.id as string, siloId: row.siloId as string, principalId: row.principalId as string, payload, resourceKind: row.resourceKind as string, resourceId: row.resourceId as string, resourceRevision: row.resourceRevision as string, desiredGeneration: row.desiredGeneration as number, argumentsDigest: row.argumentsDigest as `sha256:${string}`, materialVerifier: null, authorization: { decisionDigest: "sha256:decision", policyRevisionHash: "sha256:policy", effectiveAuthorizationDigest: "sha256:effective" }, executorProfile: _PROFILE, materialRequirement: row.materialRequirement as ProviderEffectMaterialRequirements, state: row.state as ProviderEffectCommandStates, deliveryCount: row.deliveryCount as number, claimFence: row.claimFence as string | null, claimExpiresAt: row.claimExpiresAt as Date | null, failureCode: row.failureCode as string | null, followUpCommandId: row.followUpCommandId as string | null, result: row.result as ProviderEffectCommandRecord["result"] };
}

/** Builds a transaction stub that distinguishes latest-generation and active-claim queries. */
function _transaction(rowById: Record<string, unknown>, latest: Record<string, unknown>, active: Record<string, unknown> | null = null, model: Record<string, unknown> | null = null): { readonly transaction: Prisma.TransactionClient; readonly updateCommands: ReturnType<typeof vi.fn>; readonly updateModels: ReturnType<typeof vi.fn> }
{
	const updateCommands = vi.fn(async function _UpdateCommands() { return { count: 1 }; });
	const updateModels = vi.fn(async function _UpdateModels() { return { count: 1 }; });
	const transaction = {
		providerEffectCommand: {
			findUnique: vi.fn(async function _FindUnique() { return rowById; }),
			findFirst: vi.fn(async function _FindFirst(args: { where?: { id?: { not?: string } } }) { return args.where?.id?.not ? active : latest; }),
			updateMany: updateCommands,
		},
		modelDefinition: {
			findUnique: vi.fn(async function _FindModel() { return model; }),
			findFirst: vi.fn(async function _FindDependentModel() { return null; }),
			updateMany: updateModels,
		},
		providerCredential: {
			findFirst: vi.fn(async function _FindCredential() { return null; }),
		},
	} as unknown as Prisma.TransactionClient;
	return { transaction, updateCommands, updateModels };
}

/** Builds a current authority with an explicit allow or deny result. */
function _authorization(allow: boolean): { readonly authority: AuthorizationAuthority; readonly admit: ReturnType<typeof vi.fn> }
{
	const admit = vi.fn(async function _Admit()
	{
		return allow
			? { outcome: AuthorizationDecisionOutcomes.Allow, evidence: { decisionDigest: "sha256:current", policyRevisionHash: "sha256:policy", effectiveAuthorizationDigest: "sha256:current-effective" } }
			: { outcome: AuthorizationDecisionOutcomes.Deny, evidence: null };
	});
	return { authority: { admitPrincipal: admit } as unknown as AuthorizationAuthority, admit };
}

/** Non-secret Set-BYOK payload shared by monotonic provider-state tests. */
const _SET: ProviderEffectCommandPayload = { kind: ProviderEffectCommandKinds.SetByokKey, value: { provider: "openai", secretRef: "byok-provider-key-openai", litellmCredentialName: "byok-openai" } };
/** Non-secret Delete-BYOK payload shared by monotonic provider-state tests. */
const _DELETE: ProviderEffectCommandPayload = { kind: ProviderEffectCommandKinds.DeleteByokKey, value: { provider: "openai", secretRef: "byok-provider-key-openai", litellmCredentialName: "byok-openai", litellmRegistered: false, modelDefinitionIds: [], deployments: [] } };
/** Model registration payload shared by lifecycle fencing tests. */
const _REGISTER: ProviderEffectCommandPayload = { kind: ProviderEffectCommandKinds.RegisterModel, value: { modelDefinitionId: "model-1", publicModelName: "openai/gpt", upstreamModel: "openai/gpt", scope: ModelRoutingScope.Global, clusterTenant: null, apiBase: null, apiKeyEnvRef: null, litellmCredentialName: null, routingDefaultId: null, selectedModelDefinitionId: null } };

describe("PrismaProviderEffectCommandRepository current authority and generation fencing", function _Suite()
{
	it("authorizes the exact global routing write before mutating its projection", async function _AuthorizesGlobalRoutingWrite()
	{
		const routing = { id: "routing-1", siloId: "acme", scope: "Global", clusterTenant: null, defaultModel: "openai/gpt", autoConfig: null, createdAt: new Date("2026-08-30T00:00:00.000Z"), updatedAt: new Date("2026-08-30T00:00:00.000Z") };
		const selected = { id: "model-1", siloId: "acme", scope: "Global", clusterTenant: null, publicModelName: "openai/gpt", upstreamModel: "openai/gpt", litellmModelId: "deployment-1" };
		const alias = { ...selected, id: "model-auto", publicModelName: "auto" };
		const update = vi.fn(async function _Update() { return routing; });
		const admit = vi.fn(async function _Admit() { return { outcome: AuthorizationDecisionOutcomes.Allow, evidence: { decisionDigest: "sha256:decision", policyRevisionHash: "sha256:policy", effectiveAuthorizationDigest: "sha256:effective" } }; });
		const transaction = {
			modelDefinition: { findFirst: vi.fn().mockResolvedValueOnce(selected).mockResolvedValueOnce(selected).mockResolvedValueOnce(alias) },
			modelRoutingDefault: { findFirst: vi.fn(async function _FindRouting() { return routing; }), findUnique: vi.fn(async function _FindRoutingById() { return routing; }), update },
		} as unknown as Prisma.TransactionClient;
		const repository = new PrismaProviderEffectCommandRepository(transaction);
		const autoConfig = { enabled: true, preferredModel: "openai/gpt" } as never;

		await expect(repository.reconcileGlobalRoutingDefault(_record(_row(_SET), _SET), "openai/gpt", autoConfig, _context(), { admitPrincipal: admit } as unknown as AuthorizationAuthority, new Date("2026-08-30T01:00:00.000Z"))).resolves.toMatchObject({ child: null });
		expect(admit).toHaveBeenCalledWith(expect.objectContaining({
			siloId: "acme",
			principalId: "principal-1",
			resource: { kind: ProductAuthorizationResourceKinds.Organization, id: "acme" },
			action: "administer",
			argumentsDigest: ___DigestCanonicalJson({ operation: "upsert-global-model-routing-default", siloId: "acme", defaultModel: "openai/gpt", autoConfig } as JsonValue),
		}));
		expect(update).toHaveBeenCalledOnce();
	});

	it("rolls back a global routing write when current administration is denied", async function _DeniesGlobalRoutingWrite()
	{
		const update = vi.fn();
		const transaction = {
			modelDefinition: { findFirst: vi.fn(async function _FindSelected() { return { id: "model-1", publicModelName: "openai/gpt", litellmModelId: "deployment-1" }; }) },
			modelRoutingDefault: { findFirst: vi.fn(), create: vi.fn(), update },
		} as unknown as Prisma.TransactionClient;
		const repository = new PrismaProviderEffectCommandRepository(transaction);

		await expect(repository.reconcileGlobalRoutingDefault(_record(_row(_SET), _SET), "openai/gpt", null, _context(), _authorization(false).authority, new Date("2026-08-30T01:00:00.000Z"))).rejects.toThrow("provider effect finalization is blocked");
		expect(transaction.modelRoutingDefault.findFirst).not.toHaveBeenCalled();
		expect(update).not.toHaveBeenCalled();
	});

	it("treats another administrator's matching alias child as busy without accepting its authority", async function _DifferentPrincipalChild()
	{
		const childPayload = { kind: ProviderEffectCommandKinds.RegisterModel, value: { ..._REGISTER.value, publicModelName: "auto", routingDefaultId: "routing-1", selectedModelDefinitionId: "model-selected" } } as const;
		const child = _row(childPayload, { id: "command-auto", principalId: "principal-2", resourceId: "model-1" });
		const linkedRow = _row(_SET, { state: ProviderEffectCommandStates.Succeeded, followUpCommandId: "command-auto" });
		const findUnique = vi.fn(async function _FindChild(args: { where: { id: string } }) { return args.where.id === "command-a" ? linkedRow : child; });
		const transaction = { providerEffectCommand: { findUnique } } as unknown as Prisma.TransactionClient;
		const repository = new PrismaProviderEffectCommandRepository(transaction);

		await expect(repository.findFollowUpCandidate(_record(_row(_SET), _SET), "command-auto")).resolves.toBeNull();
		const linkedParent = _record(linkedRow, _SET);
		await expect(repository.findFollowUp(linkedParent)).rejects.toThrow("invalid follow-up command");
	});

	it("allocates generation B and supersedes inactive generation A in one admission transaction", async function _AdmitsNewGeneration()
	{
		const rowA = _row(_SET);
		const create = vi.fn(async function _Create(args: { data: Record<string, unknown> }) { return { ..._row(_DELETE, { id: "command-b", resourceRevision: "revision-b", desiredGeneration: 2 }), ...args.data }; });
		const updateMany = vi.fn(async function _UpdateMany() { return { count: 1 }; });
		const transaction = {
			providerEffectCommand: {
				findFirst: vi.fn(async function _FindFirst(args: { where?: { state?: string; OR?: unknown } }) { return args.where?.state === ProviderEffectCommandStates.Claimed || args.where?.OR !== undefined ? null : rowA; }),
				create,
				updateMany,
			},
		} as unknown as Prisma.TransactionClient;
		const repository = new PrismaProviderEffectCommandRepository(transaction);

		const result = await repository.admit({ id: "command-b", siloId: "acme", principalId: "principal-1", payload: _DELETE, resourceKind: ProductAuthorizationResourceKinds.ProviderConnection, resourceId: "byok:acme:openai", resourceRevision: "revision-b", argumentsDigest: "sha256:arguments-b", materialVerifier: null, authorization: { decisionDigest: "sha256:decision-b", policyRevisionHash: "sha256:policy", effectiveAuthorizationDigest: "sha256:effective-b" }, executorProfile: _PROFILE, materialRequirement: ProviderEffectMaterialRequirements.None });

		expect(result.status).toBe(ProviderEffectAdmissionStatuses.Admitted);
		if (result.status !== ProviderEffectAdmissionStatuses.Admitted)
			throw new Error("expected generation B to be admitted");
		expect(result.command.desiredGeneration).toBe(2);
		expect(create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ desiredGeneration: 2 }) }));
		expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ desiredGeneration: { lt: 2 }, OR: expect.arrayContaining([{ state: ProviderEffectCommandStates.Pending }, { state: ProviderEffectCommandStates.AwaitingMaterial }]) }), data: expect.objectContaining({ state: ProviderEffectCommandStates.Failed, failureCode: "superseded" }) }));
	});

	it.each([_SET, _DELETE])("rejects $kind generation B admitted between generation A preflight and external delivery", async function _BlocksInterleavedAdmission(payload)
	{
		const rowA = _row(payload, { state: ProviderEffectCommandStates.Claimed, deliveryCount: 1, claimFence: "fence-a", claimExpiresAt: new Date("2026-08-30T02:00:00.000Z") });
		const create = vi.fn();
		const transaction = {
			providerEffectCommand: {
				findUnique: vi.fn(async function _FindUnique() { return rowA; }),
				findFirst: vi.fn(async function _FindFirst() { return rowA; }),
				create,
				updateMany: vi.fn(async function _UpdateMany() { return { count: 1 }; }),
			},
			providerCredential: { findFirst: vi.fn(async function _FindCredential() { return null; }) },
			modelDefinition: { findFirst: vi.fn(async function _FindDependentModel() { return null; }) },
		} as unknown as Prisma.TransactionClient;
		const repository = new PrismaProviderEffectCommandRepository(transaction);
		const handler = vi.fn();

		await expect(repository.preflight(_record(rowA, payload), _context(), _authorization(true).authority, new Date("2026-08-30T01:00:00.000Z"))).resolves.toBe(true);
		const requiresMaterial = payload.kind === ProviderEffectCommandKinds.SetByokKey;
		const materialVerifier = requiresMaterial ? "sha256:material-b" as const : null;
		const materialRequirement = requiresMaterial ? ProviderEffectMaterialRequirements.EphemeralProviderKey : ProviderEffectMaterialRequirements.None;
		const result = await repository.admit({ id: "command-b", siloId: "acme", principalId: "principal-1", payload, resourceKind: ProductAuthorizationResourceKinds.ProviderConnection, resourceId: "byok:acme:openai", resourceRevision: "revision-b", argumentsDigest: "sha256:arguments-b", materialVerifier, authorization: { decisionDigest: "sha256:decision-b", policyRevisionHash: "sha256:policy", effectiveAuthorizationDigest: "sha256:effective-b" }, executorProfile: _PROFILE, materialRequirement });
		handler();

		expect(result).toEqual({ status: ProviderEffectAdmissionStatuses.Busy, command: null, blocker: { commandId: "command-a", state: ProviderEffectCommandStates.Claimed } });
		expect(create).not.toHaveBeenCalled();
		expect(handler).toHaveBeenCalledOnce();
	});

	it("keeps an expired claim as the admission barrier while allowing that exact command to be reclaimed", async function _ExpiredClaimBarrier()
	{
		const expired = _row(_DELETE, { state: ProviderEffectCommandStates.Claimed, deliveryCount: 1, claimFence: "fence-old", claimExpiresAt: new Date("2026-08-30T00:30:00.000Z") });
		const create = vi.fn();
		const admissionTransaction = {
			providerEffectCommand: {
				findFirst: vi.fn(async function _FindFirst() { return expired; }),
				create,
			},
		} as unknown as Prisma.TransactionClient;
		const admissionRepository = new PrismaProviderEffectCommandRepository(admissionTransaction);

		const admission = await admissionRepository.admit({ id: "command-b", siloId: "acme", principalId: "principal-1", payload: _DELETE, resourceKind: ProductAuthorizationResourceKinds.ProviderConnection, resourceId: "byok:acme:openai", resourceRevision: "revision-b", argumentsDigest: "sha256:arguments-b", materialVerifier: null, authorization: { decisionDigest: "sha256:decision-b", policyRevisionHash: "sha256:policy", effectiveAuthorizationDigest: "sha256:effective-b" }, executorProfile: _PROFILE, materialRequirement: ProviderEffectMaterialRequirements.None });
		expect(admission.status).toBe(ProviderEffectAdmissionStatuses.Busy);
		expect(create).not.toHaveBeenCalled();

		const database = _transaction(expired, expired);
		const claimRepository = new PrismaProviderEffectCommandRepository(database.transaction);
		const reclaimed = await claimRepository.claim("command-a", null, _context(), _authorization(true).authority, new Date("2026-08-30T01:00:00.000Z"));
		expect(reclaimed.status).toBe(ProviderEffectExecutionStatuses.Claimed);
		expect(database.updateCommands).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ state: ProviderEffectCommandStates.Claimed, deliveryCount: { increment: 1 }, claimFence: expect.any(String) }) }));
	});

	it("retains an uncertain claim and permits exact-command convergence beyond the normal delivery budget", async function _UncertainBudget()
	{
		const uncertain = _row(_DELETE, { state: ProviderEffectCommandStates.Claimed, deliveryCount: 3, claimFence: "fence-old", claimExpiresAt: new Date("2026-08-30T00:30:00.000Z"), failureCode: _PROVIDER_EFFECT_OUTCOME_UNCERTAIN_FAILURE_CODE });
		const database = _transaction(uncertain, uncertain);
		const repository = new PrismaProviderEffectCommandRepository(database.transaction);

		await expect(repository.retainClaim(_record(uncertain, _DELETE), _PROVIDER_EFFECT_OUTCOME_UNCERTAIN_FAILURE_CODE)).resolves.toBe(ProviderEffectExecutionStatuses.Retryable);
		await expect(repository.claim("command-a", null, _context(), _authorization(true).authority, new Date("2026-08-30T01:00:00.000Z"))).resolves.toMatchObject({ status: ProviderEffectExecutionStatuses.Claimed });
		expect(database.updateCommands).not.toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ state: ProviderEffectCommandStates.Failed, failureCode: "delivery_budget_exhausted" }) }));
		expect(database.updateCommands).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ deliveryCount: { increment: 1 }, failureCode: _PROVIDER_EFFECT_OUTCOME_UNCERTAIN_FAILURE_CODE }) }));
	});

	it.each(["user", "system"] as const)("refuses a %s delivery after organisation administration is revoked", async function _Revoked(actorKind)
	{
		const row = _row(_DELETE);
		const database = _transaction(row, row);
		const authorization = _authorization(false);
		const repository = new PrismaProviderEffectCommandRepository(database.transaction);

		const result = await repository.claim("command-a", null, _context(actorKind), authorization.authority, new Date("2026-08-30T01:00:00.000Z"));

		expect(result).toEqual({ status: ProviderEffectExecutionStatuses.Failed, command: null });
		expect(authorization.admit).toHaveBeenCalledWith(expect.objectContaining({ principalId: "principal-1", actorKind, actorId: actorKind === "user" ? "principal-1" : _PROFILE }));
		expect(database.updateCommands).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ state: ProviderEffectCommandStates.Failed, failureCode: "authorization_or_resource_stale" }) }));
	});

	it("keeps an uncertain command blocking when authority is revoked before its exact retry", async function _RevokedUncertainRetry()
	{
		const row = _row(_DELETE, { state: ProviderEffectCommandStates.Claimed, deliveryCount: 4, claimFence: "fence-old", claimExpiresAt: new Date("2026-08-30T00:30:00.000Z"), failureCode: _PROVIDER_EFFECT_OUTCOME_UNCERTAIN_FAILURE_CODE });
		const database = _transaction(row, row);
		const repository = new PrismaProviderEffectCommandRepository(database.transaction);

		await expect(repository.claim("command-a", null, _context("system"), _authorization(false).authority, new Date("2026-08-30T01:00:00.000Z"))).resolves.toEqual({ status: ProviderEffectExecutionStatuses.Busy, command: null });
		expect(database.updateCommands).not.toHaveBeenCalled();
	});

	it("keeps saved finalization evidence blocking when authority remains revoked", async function _RevokedFinalizationRetry()
	{
		const savedResult = { kind: ProviderEffectCommandKinds.DeleteByokKey, provider: "openai" } as const;
		const row = _row(_DELETE, { state: ProviderEffectCommandStates.Claimed, deliveryCount: 3, claimFence: "fence-old", claimExpiresAt: new Date("2026-08-30T00:30:00.000Z"), failureCode: _PROVIDER_EFFECT_FINALIZATION_BLOCKED_FAILURE_CODE, result: savedResult });
		const database = _transaction(row, row);
		const repository = new PrismaProviderEffectCommandRepository(database.transaction);

		await expect(repository.claim("command-a", null, _context("system"), _authorization(false).authority, new Date("2026-08-30T01:00:00.000Z"))).resolves.toEqual({ status: ProviderEffectExecutionStatuses.Busy, command: null });
		expect(database.updateCommands).not.toHaveBeenCalled();
	});

	it("keeps malformed blocked finalization inert instead of replaying external I/O", async function _MalformedFinalization()
	{
		const row = _row(_DELETE, { state: ProviderEffectCommandStates.Claimed, deliveryCount: 3, claimFence: "fence-old", claimExpiresAt: new Date("2026-08-30T00:30:00.000Z"), failureCode: _PROVIDER_EFFECT_FINALIZATION_BLOCKED_FAILURE_CODE, result: null });
		const database = _transaction(row, row);
		const repository = new PrismaProviderEffectCommandRepository(database.transaction);

		await expect(repository.claim("command-a", null, _context("system"), _authorization(true).authority, new Date("2026-08-30T01:00:00.000Z"))).resolves.toEqual({ status: ProviderEffectExecutionStatuses.Busy, command: null });
		expect(database.updateCommands).not.toHaveBeenCalled();
	});

	it("reclaims saved finalization evidence without material or another delivery attempt", async function _ReclaimsFinalization()
	{
		const savedResult = { kind: ProviderEffectCommandKinds.SetByokKey, provider: "openai", secretRef: "byok-provider-key-openai", litellmCredentialName: "byok-openai", models: [], embedding: { status: ProviderEmbeddingReconciliationStatuses.Confirmed, deployments: [] } } as const;
		const row = _row(_SET, { state: ProviderEffectCommandStates.Claimed, materialRequirement: ProviderEffectMaterialRequirements.EphemeralProviderKey, materialVerifier: "sha256:material", deliveryCount: 3, claimFence: "fence-old", claimExpiresAt: new Date("2026-08-30T00:30:00.000Z"), failureCode: _PROVIDER_EFFECT_FINALIZATION_BLOCKED_FAILURE_CODE, result: savedResult });
		const database = _transaction(row, row);
		const repository = new PrismaProviderEffectCommandRepository(database.transaction);

		const claimed = await repository.claim("command-a", null, _context("system"), _authorization(true).authority, new Date("2026-08-30T01:00:00.000Z"));

		expect(claimed).toMatchObject({ status: ProviderEffectExecutionStatuses.Claimed, command: { deliveryCount: 3, result: savedResult, failureCode: _PROVIDER_EFFECT_FINALIZATION_BLOCKED_FAILURE_CODE } });
		expect(database.updateCommands).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ deliveryCount: 3, failureCode: _PROVIDER_EFFECT_FINALIZATION_BLOCKED_FAILURE_CODE }) }));
	});

	it("discovers expired saved finalization evidence beyond the delivery budget", async function _DiscoversFinalization()
	{
		const savedResult = { kind: ProviderEffectCommandKinds.DeleteByokKey, provider: "openai" } as const;
		const row = _row(_DELETE, { state: ProviderEffectCommandStates.Claimed, materialRequirement: ProviderEffectMaterialRequirements.EphemeralProviderKey, deliveryCount: 3, claimFence: "fence-old", claimExpiresAt: new Date("2026-08-30T00:30:00.000Z"), failureCode: _PROVIDER_EFFECT_FINALIZATION_BLOCKED_FAILURE_CODE, result: savedResult });
		const findFirst = vi.fn(async function _FindFirst() { return row; });
		const transaction = { providerEffectCommand: { findFirst } } as unknown as Prisma.TransactionClient;
		const repository = new PrismaProviderEffectCommandRepository(transaction);

		await expect(repository.nextRecoverable(new Date("2026-08-30T01:00:00.000Z"))).resolves.toMatchObject({ id: "command-a", result: savedResult });
		expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { OR: expect.arrayContaining([expect.objectContaining({ failureCode: _PROVIDER_EFFECT_FINALIZATION_BLOCKED_FAILURE_CODE, result: { not: Prisma.DbNull }, state: ProviderEffectCommandStates.Claimed })]) } }));
	});

	it("refuses to replace durable finalization evidence with a different outcome", async function _PreservesFinalizationEvidence()
	{
		const savedResult = { kind: ProviderEffectCommandKinds.DeleteByokKey, provider: "openai" } as const;
		const row = _row(_DELETE, { state: ProviderEffectCommandStates.Claimed, deliveryCount: 2, claimFence: "fence-a", claimExpiresAt: new Date("2026-08-30T02:00:00.000Z"), failureCode: _PROVIDER_EFFECT_FINALIZATION_BLOCKED_FAILURE_CODE, result: savedResult });
		const database = _transaction(row, row);
		const repository = new PrismaProviderEffectCommandRepository(database.transaction);

		await expect(repository.complete(_record(row, _DELETE), { kind: ProviderEffectCommandKinds.DeleteByokKey, provider: "anthropic" }, _context(), _authorization(false).authority, new Date("2026-08-30T01:00:00.000Z"))).resolves.toEqual({ status: ProviderEffectExecutionStatuses.Busy, followUpCommand: null });
		expect(database.updateCommands).not.toHaveBeenCalled();
	});

	it("refuses unexpected secret-bearing result fields before persistence", async function _RefusesSecretResultField()
	{
		const row = _row(_DELETE, { state: ProviderEffectCommandStates.Claimed, deliveryCount: 1, claimFence: "fence-a", claimExpiresAt: new Date("2026-08-30T02:00:00.000Z") });
		const database = _transaction(row, row);
		const repository = new PrismaProviderEffectCommandRepository(database.transaction);
		const result = { kind: ProviderEffectCommandKinds.DeleteByokKey, provider: "openai", providerKey: "raw-provider-key" } as never;

		await expect(repository.complete(_record(row, _DELETE), result, _context(), _authorization(false).authority, new Date("2026-08-30T01:00:00.000Z"))).rejects.toThrow();
		expect(database.updateCommands).not.toHaveBeenCalled();
	});

	it("terminalizes a saved executor profile that differs from the trusted delivery profile", async function _ExecutorProfileMismatch()
	{
		const row = _row(_DELETE, { executorProfile: "untrusted/provider-effect-v1" });
		const database = _transaction(row, row);
		const repository = new PrismaProviderEffectCommandRepository(database.transaction);

		await expect(repository.claim("command-a", null, _context("system"), _authorization(true).authority, new Date("2026-08-30T01:00:00.000Z"))).resolves.toEqual({ status: ProviderEffectExecutionStatuses.Failed, command: null });
		expect(database.updateCommands).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ state: ProviderEffectCommandStates.Failed, failureCode: "executor_profile_mismatch" }) }));
	});

	it.each([_SET, _DELETE, _REGISTER])("stops stale $kind generation A at the pre-I/O fence", async function _StalePreflight(payload)
	{
		const rowA = _row(payload, { state: ProviderEffectCommandStates.Claimed, deliveryCount: 1, claimFence: "fence-a", claimExpiresAt: new Date("2026-08-30T02:00:00.000Z") });
		const rowB = _row(payload, { id: "command-b", resourceRevision: "revision-b", desiredGeneration: 2 });
		const database = _transaction(rowA, rowB);
		const authorization = _authorization(true);
		const repository = new PrismaProviderEffectCommandRepository(database.transaction);
		const context = payload.kind === ProviderEffectCommandKinds.RegisterModel ? { ..._context(), resourceKind: ProductAuthorizationResourceKinds.ModelDefinition, resourceId: "model-1" } : _context();

		await expect(repository.preflight(_record(rowA, payload), context, authorization.authority, new Date("2026-08-30T01:00:00.000Z"))).resolves.toBe(false);
		expect(database.updateCommands).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ state: ProviderEffectCommandStates.Failed }) }));
	});

	it("keeps generation B pending while generation A owns an unexpired resource claim", async function _SerializesGenerations()
	{
		const rowB = _row(_DELETE, { id: "command-b", resourceRevision: "revision-b", desiredGeneration: 2 });
		const activeA = _row(_SET, { state: ProviderEffectCommandStates.Claimed, deliveryCount: 1, claimFence: "fence-a", claimExpiresAt: new Date("2026-08-30T02:00:00.000Z") });
		const database = _transaction(rowB, rowB, activeA);
		const authorization = _authorization(true);
		const repository = new PrismaProviderEffectCommandRepository(database.transaction);

		await expect(repository.claim("command-b", null, _context(), authorization.authority, new Date("2026-08-30T01:00:00.000Z"))).resolves.toEqual({ status: ProviderEffectExecutionStatuses.Busy, command: null });
		expect(database.updateCommands).not.toHaveBeenCalled();
	});

	it("refuses registration when the model definition changed after admission", async function _ChangedModel()
	{
		const row = _row(_REGISTER, { state: ProviderEffectCommandStates.Claimed, deliveryCount: 1, claimFence: "fence-a", claimExpiresAt: new Date("2026-08-30T02:00:00.000Z") });
		const changedModel = { id: "model-1", scope: "Global", clusterTenant: null, publicModelName: "openai/gpt", upstreamModel: "openai/changed", apiBase: null, litellmModelId: "pending:command-a", providerCredential: null };
		const database = _transaction(row, row, null, changedModel);
		const repository = new PrismaProviderEffectCommandRepository(database.transaction);
		const context = { ..._context(), resourceKind: ProductAuthorizationResourceKinds.ModelDefinition, resourceId: "model-1" };

		await expect(repository.preflight(_record(row, _REGISTER), context, _authorization(true).authority, new Date("2026-08-30T01:00:00.000Z"))).resolves.toBe(false);
		expect(database.updateModels).not.toHaveBeenCalled();
	});

	it("refuses registration when the model definition was deleted after admission", async function _DeletedModel()
	{
		const row = _row(_REGISTER, { state: ProviderEffectCommandStates.Claimed, deliveryCount: 1, claimFence: "fence-a", claimExpiresAt: new Date("2026-08-30T02:00:00.000Z") });
		const database = _transaction(row, row, null, null);
		const repository = new PrismaProviderEffectCommandRepository(database.transaction);
		const context = { ..._context(), resourceKind: ProductAuthorizationResourceKinds.ModelDefinition, resourceId: "model-1" };

		await expect(repository.preflight(_record(row, _REGISTER), context, _authorization(true).authority, new Date("2026-08-30T01:00:00.000Z"))).resolves.toBe(false);
		expect(database.updateModels).not.toHaveBeenCalled();
	});

	it("refuses provider-key deletion when a model begins depending on the credential before delivery", async function _DeleteDependencyRace()
	{
		const row = _row(_DELETE, { state: ProviderEffectCommandStates.Claimed, deliveryCount: 1, claimFence: "fence-a", claimExpiresAt: new Date("2026-08-30T02:00:00.000Z") });
		const database = _transaction(row, row);
		const transaction = database.transaction as unknown as { providerCredential: { findFirst: ReturnType<typeof vi.fn> }; modelDefinition: { findMany: ReturnType<typeof vi.fn> } };
		transaction.providerCredential.findFirst.mockResolvedValue({ id: "credential-1", litellmCredentialName: "byok-openai", updatedAt: new Date("2026-08-30T00:00:00.000Z") });
		transaction.modelDefinition.findMany = vi.fn(async function _FindDependentModels()
		{
			return [{ id: "model-1", publicModelName: "openai/gpt", upstreamModel: "openai/gpt", litellmModelId: "deployment-1", apiBase: null, isDefault: false, agentRevisions: [{ id: "revision-1" }] }];
		});
		const repository = new PrismaProviderEffectCommandRepository(database.transaction);

		await expect(repository.preflight(_record(row, _DELETE), _context(), _authorization(true).authority, new Date("2026-08-30T01:00:00.000Z"))).resolves.toBe(false);
		expect(database.updateCommands).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ state: ProviderEffectCommandStates.Failed, failureCode: "authorization_or_resource_stale" }) }));
	});

	it("does not project a completed registration after a newer model generation wins", async function _StaleFinalization()
	{
		const rowA = _row(_REGISTER, { state: ProviderEffectCommandStates.Claimed, deliveryCount: 1, claimFence: "fence-a", claimExpiresAt: new Date("2026-08-30T02:00:00.000Z") });
		const rowB = _row(_REGISTER, { id: "command-b", resourceRevision: "revision-b", desiredGeneration: 2 });
		const database = _transaction(rowA, rowB);
		const repository = new PrismaProviderEffectCommandRepository(database.transaction);
		const context = { ..._context(), resourceKind: ProductAuthorizationResourceKinds.ModelDefinition, resourceId: "model-1" };

		await expect(repository.complete(_record(rowA, _REGISTER), { kind: ProviderEffectCommandKinds.RegisterModel, litellmModelId: "deployment-a" }, context, _authorization(true).authority, new Date("2026-08-30T01:00:00.000Z"))).resolves.toEqual({ status: ProviderEffectExecutionStatuses.Busy, followUpCommand: null });
		expect(database.updateModels).not.toHaveBeenCalled();
	});

	it("keeps the command barrier and projections untouched when authority is revoked after external I/O", async function _DeniedProviderProjection()
	{
		const row = _row(_SET, { state: ProviderEffectCommandStates.Claimed, deliveryCount: 1, claimFence: "fence-a", claimExpiresAt: new Date("2026-08-30T02:00:00.000Z") });
		const credentialCreate = vi.fn();
		const modelCreate = vi.fn();
		const routingCreate = vi.fn();
		const transaction = {
			providerEffectCommand: {
				findUnique: vi.fn(async function _FindUnique() { return row; }),
				findFirst: vi.fn(async function _FindFirst() { return row; }),
				updateMany: vi.fn(async function _Terminalize() { return { count: 1 }; }),
			},
			providerCredential: { create: credentialCreate },
			modelDefinition: { create: modelCreate },
			modelRoutingDefault: { create: routingCreate },
		} as unknown as Prisma.TransactionClient;
		const repository = new PrismaProviderEffectCommandRepository(transaction);
		const result = { kind: ProviderEffectCommandKinds.SetByokKey, provider: "openai", secretRef: "byok-provider-key-openai", litellmCredentialName: "byok-openai", models: [{ publicModelName: "openai/gpt-5.5", upstreamModel: "openai/gpt-5.5", litellmModelId: "deployment-1" }], embedding: { status: ProviderEmbeddingReconciliationStatuses.Confirmed, deployments: [{ publicModelName: "openai/text-embedding-3-large", upstreamModel: "openai/text-embedding-3-large", litellmModelId: "embedding-1" }, { publicModelName: "auto-embedding", upstreamModel: "openai/text-embedding-3-large", litellmModelId: "embedding-2" }] } } as const;

		await expect(repository.complete(_record(row, _SET), result, _context(), _authorization(false).authority, new Date("2026-08-30T01:00:00.000Z"))).resolves.toEqual({ status: ProviderEffectExecutionStatuses.Busy, followUpCommand: null });
		expect(transaction.providerEffectCommand.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ result, failureCode: _PROVIDER_EFFECT_FINALIZATION_BLOCKED_FAILURE_CODE }) }));
		expect(credentialCreate).not.toHaveBeenCalled();
		expect(modelCreate).not.toHaveBeenCalled();
		expect(routingCreate).not.toHaveBeenCalled();
	});

	it("projects the provider catalogue and admits one durable global alias child", async function _FinalizesProviderProjection()
	{
		const row = _row(_SET, { state: ProviderEffectCommandStates.Claimed, deliveryCount: 1, claimFence: "fence-a", claimExpiresAt: new Date("2026-08-30T02:00:00.000Z") });
		const models = new Map<string, Record<string, unknown>>();
		let routingDefault: Record<string, unknown> | null = null;
		let child: Record<string, unknown> | null = null;
		const transaction = {
			providerEffectCommand: {
				findUnique: vi.fn(async function _FindUnique(args: { where: { id: string } }) { return args.where.id === row.id ? row : child; }),
				findFirst: vi.fn(async function _FindFirst(args: { where?: { resourceId?: string; state?: unknown; OR?: unknown } })
				{
					if (args.where?.resourceId !== undefined && args.where.resourceId !== row.resourceId)
						return null;
					if (args.where?.state !== undefined || args.where?.OR !== undefined)
						return null;
					return row;
				}),
				create: vi.fn(async function _CreateCommand(args: { data: Record<string, unknown> })
				{
					child = _row(_REGISTER, { ...args.data, id: args.data.id, resourceId: args.data.resourceId, resourceRevision: args.data.resourceRevision, desiredGeneration: 1, payload: args.data.payload });
					return child;
				}),
				updateMany: vi.fn(async function _Update() { return { count: 1 }; }),
			},
			providerCredential: {
				findFirst: vi.fn(async function _FindCredential() { return null; }),
				create: vi.fn(async function _CreateCredential() { return { id: "credential-1" }; }),
			},
			modelDefinition: {
				findFirst: vi.fn(async function _FindModel(args: { where: { publicModelName?: string } })
				{
					const found = Array.from(models.values()).find(model => model.publicModelName === args.where.publicModelName) ?? null;
					if (found === null)
						return null;
					const providerCredential = found.providerCredentialId === "credential-1" ? { secretRef: "byok-provider-key-openai", litellmCredentialName: "byok-openai" } : null;
					return { ...found, providerCredential };
				}),
				create: vi.fn(async function _CreateModel(args: { data: Record<string, unknown> }) { const model = { id: `model-${models.size + 1}`, generatedOutputCapabilities: [], ...args.data }; models.set(model.id, model); return model; }),
				update: vi.fn(async function _UpdateModel(args: { where: { id: string }; data: Record<string, unknown> }) { const model = { ...models.get(args.where.id), ...args.data }; models.set(args.where.id, model); return model; }),
				findMany: vi.fn(async function _Defaults() { return Array.from(models.values()).filter(model => model.isDefault === true); }),
			},
			modelRoutingDefault: {
				findFirst: vi.fn(async function _FindRoutingDefault() { return routingDefault; }),
				create: vi.fn(async function _CreateRoutingDefault(args: { data: Record<string, unknown> }) { routingDefault = { id: "routing-1", ...args.data }; return routingDefault; }),
				update: vi.fn(async function _UpdateRoutingDefault(args: { data: Record<string, unknown> }) { routingDefault = { ...routingDefault, ...args.data }; return routingDefault; }),
			},
		} as unknown as Prisma.TransactionClient;
		const repository = new PrismaProviderEffectCommandRepository(transaction);
		const modelNames = ["openai/gpt-5.5", "openai/gpt-5.4", "openai/gpt-5.4-nano"];
		const result = { kind: ProviderEffectCommandKinds.SetByokKey, provider: "openai", secretRef: "byok-provider-key-openai", litellmCredentialName: "byok-openai", models: modelNames.map(function _Projection(publicModelName, index) { return { publicModelName, upstreamModel: publicModelName, litellmModelId: `deployment-${index}` }; }), embedding: { status: ProviderEmbeddingReconciliationStatuses.Confirmed, deployments: [{ publicModelName: "openai/text-embedding-3-large", upstreamModel: "openai/text-embedding-3-large", litellmModelId: "embedding-1" }, { publicModelName: "auto-embedding", upstreamModel: "openai/text-embedding-3-large", litellmModelId: "embedding-2" }] } } as const;

		const completion = await repository.complete(_record(row, _SET), result, _context(), _authorization(true).authority, new Date("2026-08-30T01:00:00.000Z"));
		expect(completion).toMatchObject({ status: ProviderEffectExecutionStatuses.Succeeded, followUpCommand: { payload: { kind: ProviderEffectCommandKinds.RegisterModel, value: { publicModelName: "auto", routingDefaultId: "routing-1", selectedModelDefinitionId: expect.any(String) } } } });
		expect(models.size).toBe(4);
		expect(Array.from(models.values()).find(model => model.publicModelName === "openai/gpt-5.5")).toMatchObject({ isDefault: false, providerCredentialId: "credential-1" });
		expect(routingDefault).toMatchObject({ defaultModel: "openai/gpt-5.5" });
		expect(child).toMatchObject({ principalId: "principal-1", executorProfile: _PROFILE, resourceKind: ProductAuthorizationResourceKinds.ModelDefinition });
	});
});
