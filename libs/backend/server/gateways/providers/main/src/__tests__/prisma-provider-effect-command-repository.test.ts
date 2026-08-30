import { describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";

import type { AuthorizationAuthority } from "@opencrane/backend/server/iam/authorization";
import { AuthorizationDecisionOutcomes, ProductAuthorizationResourceKinds } from "@opencrane/models/authorization";
import { ModelRoutingScope } from "@opencrane/contracts";

import { PrismaProviderEffectCommandRepository } from "../prisma-provider-effect-command-repository";
import { ProviderEffectCommandKinds, ProviderEffectCommandStates, ProviderEffectExecutionStatuses, ProviderEffectMaterialRequirements, type ProviderEffectCommandPayload, type ProviderEffectCommandRecord, type ProviderEffectExecutionContext } from "../provider-effect-command.types";

/** Stable executor profile shared by current-authority repository tests. */
const _PROFILE = "opencrane-control-plane/provider-effect-v1";

/** Builds one current request or system delivery context. */
function _context(actorKind: "user" | "system" = "user"): ProviderEffectExecutionContext
{
	return { siloId: "acme", principalId: "principal-1", actorKind, actorId: actorKind === "user" ? "principal-1" : _PROFILE, resourceKind: ProductAuthorizationResourceKinds.ProviderConnection, resourceId: "byok:openai", executorProfile: _PROFILE };
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
		resourceId: payload.kind === ProviderEffectCommandKinds.RegisterModel ? payload.value.modelDefinitionId : `byok:${payload.value.provider}`,
		resourceRevision: "revision-a",
		desiredGeneration: 1,
		argumentsDigest: "sha256:arguments",
		materialVerifier: null,
		authorizationDecisionDigest: "sha256:decision",
		authorizationPolicyRevisionHash: "sha256:policy",
		effectiveAuthorizationDigest: "sha256:effective",
		approvalId: null,
		executorProfile: _PROFILE,
		materialRequirement: ProviderEffectMaterialRequirements.None,
		payload: payload.value,
		state: ProviderEffectCommandStates.Pending,
		deliveryCount: 0,
		claimFence: null,
		claimExpiresAt: null,
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
	return { id: row.id as string, siloId: row.siloId as string, principalId: row.principalId as string, payload, resourceKind: row.resourceKind as string, resourceId: row.resourceId as string, resourceRevision: row.resourceRevision as string, desiredGeneration: row.desiredGeneration as number, argumentsDigest: row.argumentsDigest as `sha256:${string}`, materialVerifier: null, authorization: { decisionDigest: "sha256:decision", policyRevisionHash: "sha256:policy", effectiveAuthorizationDigest: "sha256:effective" }, approvalId: null, executorProfile: _PROFILE, materialRequirement: ProviderEffectMaterialRequirements.None, state: row.state as ProviderEffectCommandStates, deliveryCount: row.deliveryCount as number, claimFence: row.claimFence as string | null, claimExpiresAt: row.claimExpiresAt as Date | null };
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
			updateMany: updateModels,
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
const _DELETE: ProviderEffectCommandPayload = { kind: ProviderEffectCommandKinds.DeleteByokKey, value: { provider: "openai", secretRef: "byok-provider-key-openai", litellmCredentialName: "byok-openai" } };
/** Model registration payload shared by lifecycle fencing tests. */
const _REGISTER: ProviderEffectCommandPayload = { kind: ProviderEffectCommandKinds.RegisterModel, value: { modelDefinitionId: "model-1", publicModelName: "openai/gpt", upstreamModel: "openai/gpt", scope: ModelRoutingScope.Global, clusterTenant: null, apiBase: null, apiKeyEnvRef: null, litellmCredentialName: null } };

describe("PrismaProviderEffectCommandRepository current authority and generation fencing", function _Suite()
{
	it("allocates generation B and supersedes inactive generation A in one admission transaction", async function _AdmitsNewGeneration()
	{
		const rowA = _row(_SET);
		const create = vi.fn(async function _Create(args: { data: Record<string, unknown> }) { return { ..._row(_DELETE, { id: "command-b", resourceRevision: "revision-b", desiredGeneration: 2 }), ...args.data }; });
		const updateMany = vi.fn(async function _UpdateMany() { return { count: 1 }; });
		const transaction = {
			providerEffectCommand: {
				findFirst: vi.fn(async function _FindFirst() { return rowA; }),
				create,
				updateMany,
			},
		} as unknown as Prisma.TransactionClient;
		const repository = new PrismaProviderEffectCommandRepository(transaction);

		const result = await repository.admit({ id: "command-b", siloId: "acme", principalId: "principal-1", payload: _DELETE, resourceKind: ProductAuthorizationResourceKinds.ProviderConnection, resourceId: "byok:openai", resourceRevision: "revision-b", argumentsDigest: "sha256:arguments-b", materialVerifier: null, authorization: { decisionDigest: "sha256:decision-b", policyRevisionHash: "sha256:policy", effectiveAuthorizationDigest: "sha256:effective-b" }, approvalId: null, executorProfile: _PROFILE, materialRequirement: ProviderEffectMaterialRequirements.None });

		expect(result.desiredGeneration).toBe(2);
		expect(create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ desiredGeneration: 2 }) }));
		expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ desiredGeneration: { lt: 2 }, OR: expect.arrayContaining([{ state: ProviderEffectCommandStates.Pending }, { state: ProviderEffectCommandStates.AwaitingMaterial }]) }), data: expect.objectContaining({ state: ProviderEffectCommandStates.Failed, failureCode: "superseded" }) }));
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

	it("does not project a completed registration after a newer model generation wins", async function _StaleFinalization()
	{
		const rowA = _row(_REGISTER, { state: ProviderEffectCommandStates.Claimed, deliveryCount: 1, claimFence: "fence-a", claimExpiresAt: new Date("2026-08-30T02:00:00.000Z") });
		const rowB = _row(_REGISTER, { id: "command-b", resourceRevision: "revision-b", desiredGeneration: 2 });
		const database = _transaction(rowA, rowB);
		const repository = new PrismaProviderEffectCommandRepository(database.transaction);
		const context = { ..._context(), resourceKind: ProductAuthorizationResourceKinds.ModelDefinition, resourceId: "model-1" };

		await expect(repository.complete(_record(rowA, _REGISTER), { kind: ProviderEffectCommandKinds.RegisterModel, litellmModelId: "deployment-a" }, context, _authorization(true).authority, new Date("2026-08-30T01:00:00.000Z"))).resolves.toBe(ProviderEffectExecutionStatuses.Failed);
		expect(database.updateModels).not.toHaveBeenCalled();
	});
});
