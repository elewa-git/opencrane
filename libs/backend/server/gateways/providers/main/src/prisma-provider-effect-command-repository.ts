import { randomUUID } from "node:crypto";

import { ProviderEffectCommandState, type Prisma } from "@prisma/client";
import type { AuthorizationAuthority } from "@opencrane/backend/server/iam/authorization";
import { AuthorizationDecisionOutcomes, ProductAuthorizationActions, ProductAuthorizationResourceKinds } from "@opencrane/models/authorization";
import { ___DigestCanonicalJson, type JsonValue } from "@opencrane/util";
import { _BYOK_PROVIDER_CATALOG, ProviderEmbeddingReconciliationStatuses } from "@opencrane/backend/server/gateways/model-routing";

import { ProviderEffectAdmissionStatuses, ProviderEffectCommandKinds, ProviderEffectCommandStates, ProviderEffectExecutionStatuses, ProviderEffectMaterialRequirements, type AdmitProviderEffectCommand, type ProviderEffectAdmissionResult, type ProviderEffectClaimResult, type ProviderEffectCommandRecord, type ProviderEffectCommandRepository, type ProviderEffectExecutionContext, type ProviderEffectHandlerResult, type ProviderEffectResourceBlocker } from "./provider-effect-command.types";
import { _PROVIDER_EFFECT_OUTCOME_UNCERTAIN_FAILURE_CODE } from "./provider-effect-command-errors";
import { _ParseProviderEffectCommandPayload, _ValidateProviderEffectCommandResourceBinding } from "./provider-effect-command.validator";

/** Maximum number of external deliveries before a command needs a fresh administrator request. */
const _MAX_DELIVERIES = 3;
/** Claim duration long enough for the bounded Kubernetes and LiteLLM requests in one delivery. */
const _CLAIM_DURATION_MS = 120_000;

/**
 * Stores and fences provider commands inside a transaction supplied by the owning unit of work.
 *
 * Admission callers use this repository in the same Serializable transaction as central
 * authorization evidence. Delivery callers commit a short claim before external I/O, then open a
 * new transaction to save the result. The repository never calls Kubernetes or LiteLLM.
 *
 * Called by: provider routes during admission and {@link PrismaProviderEffectCommandUnitOfWork}
 * during delivery.
 */
export class PrismaProviderEffectCommandRepository implements ProviderEffectCommandRepository
{
	/** Transaction that owns every provider-command read and write in this repository instance. */
	private readonly transaction: Prisma.TransactionClient;

	/**
	 * Binds command persistence to a transaction already held by the caller.
	 *
	 * @param transaction - Prisma transaction that also owns protected state or delivery fencing.
	 */
	constructor(transaction: Prisma.TransactionClient)
	{
		this.transaction = transaction;
	}

	/** @inheritdoc */
	async admit(command: AdmitProviderEffectCommand): Promise<ProviderEffectAdmissionResult>
	{
		_ValidateProviderEffectCommandResourceBinding(command.payload, command.resourceKind, command.resourceId);
		const claimed = await this.transaction.providerEffectCommand.findFirst({ where: { siloId: command.siloId, resourceKind: command.resourceKind, resourceId: command.resourceId, OR: [{ state: ProviderEffectCommandState.Claimed }, { state: { in: [ProviderEffectCommandState.Pending, ProviderEffectCommandState.AwaitingMaterial] }, failureCode: _PROVIDER_EFFECT_OUTCOME_UNCERTAIN_FAILURE_CODE }] }, orderBy: { desiredGeneration: "desc" } });
		if (claimed !== null)
			return { status: ProviderEffectAdmissionStatuses.Busy, command: null, blocker: { commandId: claimed.id, state: claimed.state as ProviderEffectCommandStates } };
		const previous = await this.transaction.providerEffectCommand.findFirst({ where: { siloId: command.siloId, resourceKind: command.resourceKind, resourceId: command.resourceId }, orderBy: { desiredGeneration: "desc" } });
		const desiredGeneration = (previous?.desiredGeneration ?? 0) + 1;
		const now = new Date();
		const row = await this.transaction.providerEffectCommand.create({ data: { id: command.id, siloId: command.siloId, principalId: command.principalId, kind: command.payload.kind, resourceKind: command.resourceKind, resourceId: command.resourceId, resourceRevision: command.resourceRevision, desiredGeneration, argumentsDigest: command.argumentsDigest, materialVerifier: command.materialVerifier, authorizationDecisionDigest: command.authorization.decisionDigest, authorizationPolicyRevisionHash: command.authorization.policyRevisionHash, effectiveAuthorizationDigest: command.authorization.effectiveAuthorizationDigest, approvalId: command.approvalId, executorProfile: command.executorProfile, materialRequirement: command.materialRequirement, payload: command.payload.value as unknown as Prisma.InputJsonValue } });
		await this.transaction.providerEffectCommand.updateMany({ where: { siloId: command.siloId, resourceKind: command.resourceKind, resourceId: command.resourceId, desiredGeneration: { lt: desiredGeneration }, OR: [{ state: ProviderEffectCommandState.Pending }, { state: ProviderEffectCommandState.AwaitingMaterial }, { state: ProviderEffectCommandState.Claimed, claimExpiresAt: { lte: now } }] }, data: { state: ProviderEffectCommandState.Failed, failureCode: "superseded", claimFence: null, claimExpiresAt: null, completedAt: now } });
		return { status: ProviderEffectAdmissionStatuses.Admitted, command: _toRecord(row), blocker: null };
	}

	/** @inheritdoc */
	async findResourceBlocker(siloId: string, resourceKind: string, resourceId: string): Promise<ProviderEffectResourceBlocker | null>
	{
		const row = await this.transaction.providerEffectCommand.findFirst({ where: { siloId, resourceKind, resourceId, state: { in: [ProviderEffectCommandState.Pending, ProviderEffectCommandState.AwaitingMaterial, ProviderEffectCommandState.Claimed] } }, orderBy: { desiredGeneration: "desc" } });
		return row === null ? null : { commandId: row.id, state: row.state as ProviderEffectCommandStates };
	}

	/** @inheritdoc */
	async nextRecoverable(now: Date): Promise<ProviderEffectCommandRecord | null>
	{
		const row = await this.transaction.providerEffectCommand.findFirst({
			where: {
				materialRequirement: ProviderEffectMaterialRequirements.None,
				deliveryCount: { lt: _MAX_DELIVERIES },
				OR: [
					{ state: ProviderEffectCommandState.Pending },
					{ state: ProviderEffectCommandState.Claimed, claimExpiresAt: { lte: now } },
				],
			},
			orderBy: [{ createdAt: "asc" }, { id: "asc" }],
		});
		return row === null ? null : _toRecord(row);
	}

	/** @inheritdoc */
	async claim(commandId: string, materialVerifier: `sha256:${string}` | null, context: ProviderEffectExecutionContext, authorization: AuthorizationAuthority, now: Date): Promise<ProviderEffectClaimResult>
	{
		// 1. Read the saved state so terminal commands and unexpired claims cannot run again.
		const current = await this.transaction.providerEffectCommand.findUnique({ where: { id: commandId } });
		if (current === null)
			return { status: ProviderEffectExecutionStatuses.Failed, command: null };
		if (current.executorProfile !== context.executorProfile)
		{
			await this._terminalize(current, "executor_profile_mismatch", now);
			return { status: ProviderEffectExecutionStatuses.Failed, command: null };
		}
		if (!_contextMatches(current, context))
			return { status: ProviderEffectExecutionStatuses.Failed, command: null };
		if (current.state === ProviderEffectCommandState.Succeeded)
			return { status: ProviderEffectExecutionStatuses.AlreadySucceeded, command: null };
		if (current.state === ProviderEffectCommandState.Failed)
			return { status: ProviderEffectExecutionStatuses.Failed, command: null };
		if (current.state === ProviderEffectCommandState.Claimed && current.claimExpiresAt !== null && current.claimExpiresAt > now)
			return { status: ProviderEffectExecutionStatuses.Busy, command: null };
		if (!await this._isCurrentAndEligible(current) || !await _isAuthorized(current, context, authorization, now))
		{
			if (current.failureCode === _PROVIDER_EFFECT_OUTCOME_UNCERTAIN_FAILURE_CODE)
				return { status: ProviderEffectExecutionStatuses.Busy, command: null };
			await this._terminalize(current, "authorization_or_resource_stale", now);
			return { status: ProviderEffectExecutionStatuses.Failed, command: null };
		}

		// 2. A raw-key command stays visible but inert until the caller supplies the same command-bound material.
		if (current.materialRequirement === "EphemeralProviderKey" && (materialVerifier === null || current.materialVerifier !== materialVerifier))
		{
			if (current.state !== ProviderEffectCommandState.AwaitingMaterial)
				await this.transaction.providerEffectCommand.updateMany({ where: { id: current.id, state: current.state, updatedAt: current.updatedAt }, data: { state: ProviderEffectCommandState.AwaitingMaterial, claimFence: null, claimExpiresAt: null } });
			return { status: ProviderEffectExecutionStatuses.AwaitingMaterial, command: null };
		}

		// 3. Replace a pending or expired claim with a new fence so external I/O starts after commit.
		if (current.deliveryCount >= _MAX_DELIVERIES && current.failureCode !== _PROVIDER_EFFECT_OUTCOME_UNCERTAIN_FAILURE_CODE)
		{
			await this.transaction.providerEffectCommand.updateMany({ where: { id: current.id, state: current.state, updatedAt: current.updatedAt }, data: { state: ProviderEffectCommandState.Failed, failureCode: "delivery_budget_exhausted", claimFence: null, claimExpiresAt: null, completedAt: now } });
			return { status: ProviderEffectExecutionStatuses.Failed, command: null };
		}
		const activeOlder = await this.transaction.providerEffectCommand.findFirst({ where: { siloId: current.siloId, resourceKind: current.resourceKind, resourceId: current.resourceId, id: { not: current.id }, state: ProviderEffectCommandState.Claimed } });
		if (activeOlder !== null)
			return { status: ProviderEffectExecutionStatuses.Busy, command: null };
		const claimFence = randomUUID();
		const claimExpiresAt = new Date(now.getTime() + _CLAIM_DURATION_MS);
		const failureCode = current.failureCode === _PROVIDER_EFFECT_OUTCOME_UNCERTAIN_FAILURE_CODE ? current.failureCode : null;
		const updated = await this.transaction.providerEffectCommand.updateMany({ where: { id: current.id, state: current.state, deliveryCount: current.deliveryCount, updatedAt: current.updatedAt }, data: { state: ProviderEffectCommandState.Claimed, deliveryCount: { increment: 1 }, claimFence, claimExpiresAt, failureCode } });
		if (updated.count !== 1)
			return { status: ProviderEffectExecutionStatuses.Busy, command: null };
		const claimed = await this.transaction.providerEffectCommand.findUnique({ where: { id: current.id } });
		if (claimed === null)
			throw new Error("claimed provider effect command disappeared before commit");
		return { status: ProviderEffectExecutionStatuses.Claimed, command: _toRecord(claimed) };
	}

	/** @inheritdoc */
	async preflight(command: ProviderEffectCommandRecord, context: ProviderEffectExecutionContext, authorization: AuthorizationAuthority, now: Date): Promise<boolean>
	{
		const current = await this.transaction.providerEffectCommand.findUnique({ where: { id: command.id } });
		if (current === null || !_contextMatches(current, context) || current.state !== ProviderEffectCommandState.Claimed || current.claimFence !== command.claimFence || current.deliveryCount !== command.deliveryCount)
			return false;
		if (await this._isCurrentAndEligible(current) && await _isAuthorized(current, context, authorization, now))
			return true;
		if (current.failureCode === _PROVIDER_EFFECT_OUTCOME_UNCERTAIN_FAILURE_CODE)
			return false;
		await this._terminalize(current, "authorization_or_resource_stale", now);
		return false;
	}

	/** @inheritdoc */
	async complete(command: ProviderEffectCommandRecord, result: ProviderEffectHandlerResult, context: ProviderEffectExecutionContext, authorization: AuthorizationAuthority, completedAt: Date): Promise<ProviderEffectExecutionStatuses>
	{
		if (command.payload.kind !== result.kind)
			throw new Error("provider effect result kind does not match its claimed command");
		const current = await this.transaction.providerEffectCommand.findUnique({ where: { id: command.id } });
		if (current === null || !_contextMatches(current, context) || current.state !== ProviderEffectCommandState.Claimed || current.claimFence !== command.claimFence || current.deliveryCount !== command.deliveryCount)
			return ProviderEffectExecutionStatuses.Busy;
		if (!await this._isCurrentAndEligible(current) || !await _isAuthorized(current, context, authorization, completedAt))
			return ProviderEffectExecutionStatuses.Busy;
		const updated = await this.transaction.providerEffectCommand.updateMany({ where: { id: command.id, state: ProviderEffectCommandState.Claimed, claimFence: command.claimFence, deliveryCount: command.deliveryCount }, data: { state: ProviderEffectCommandState.Succeeded, result: result as unknown as Prisma.InputJsonValue, failureCode: null, claimFence: null, claimExpiresAt: null, completedAt } });
		if (updated.count !== 1)
			return ProviderEffectExecutionStatuses.Busy;
		await this._persistProjection(command, result);
		return ProviderEffectExecutionStatuses.Succeeded;
	}

	/** Persists the protected product projection after the command fence has been atomically won. */
	private async _persistProjection(command: ProviderEffectCommandRecord, result: ProviderEffectHandlerResult): Promise<void>
	{
		switch (result.kind)
		{
			case ProviderEffectCommandKinds.SetByokKey:
			{
				if (command.payload.kind !== ProviderEffectCommandKinds.SetByokKey || result.provider !== command.payload.value.provider || result.secretRef !== command.payload.value.secretRef || (result.litellmCredentialName !== null && result.litellmCredentialName !== command.payload.value.litellmCredentialName))
					throw new Error("provider credential projection does not match its claimed command");
				const where = { scope: "Global" as const, clusterTenant: null, provider: result.provider };
				const existing = await this.transaction.providerCredential.findFirst({ where });
				if (existing === null)
				{
					const credential = await this.transaction.providerCredential.create({ data: { ...where, secretRef: result.secretRef, litellmCredentialName: result.litellmCredentialName } });
					await this._persistProviderModels(result, credential.id);
				}
				else
				{
					await this.transaction.providerCredential.update({ where: { id: existing.id }, data: { secretRef: result.secretRef, litellmCredentialName: result.litellmCredentialName } });
					await this._persistProviderModels(result, existing.id);
				}
				return;
			}
			case ProviderEffectCommandKinds.DeleteByokKey:
				if (command.payload.kind !== ProviderEffectCommandKinds.DeleteByokKey || result.provider !== command.payload.value.provider)
					throw new Error("provider credential removal does not match its claimed command");
				await this.transaction.providerCredential.deleteMany({ where: { scope: "Global", clusterTenant: null, provider: result.provider } });
				return;
			case ProviderEffectCommandKinds.RegisterModel:
			{
				if (command.payload.kind !== ProviderEffectCommandKinds.RegisterModel)
					throw new Error("model registration result belongs to a different provider command");
				const model = await this.transaction.modelDefinition.updateMany({ where: { id: command.payload.value.modelDefinitionId, litellmModelId: `pending:${command.id}` }, data: { litellmModelId: result.litellmModelId } });
				if (model.count !== 1)
					throw new Error("current model registration command lost its pending projection");
			}
		}
	}

	/** Validates and saves the provider catalogue, first default, and routing default in this transaction. */
	private async _persistProviderModels(result: Extract<ProviderEffectHandlerResult, { readonly kind: ProviderEffectCommandKinds.SetByokKey }>, providerCredentialId: string): Promise<void>
	{
		const catalog = _BYOK_PROVIDER_CATALOG[result.provider];
		const cheapest = catalog?.models.find(function _Fast(model) { return model.className === "fast"; }) ?? catalog?.models.at(-1);
		const expected = [...(catalog?.models.map(function _Model(model) { return { publicModelName: model.slug, upstreamModel: model.slug }; }) ?? [])];
		if (cheapest !== undefined)
			expected.push({ publicModelName: "auto", upstreamModel: cheapest.slug });
		const actual = result.models.map(function _Model(model) { return { publicModelName: model.publicModelName, upstreamModel: model.upstreamModel }; });
		const expectedDefault = catalog?.models.find(function _Default(model) { return model.className === catalog.defaultClass; })?.slug ?? null;
		if (JSON.stringify(actual) !== JSON.stringify(expected) || result.defaultPublicModelName !== expectedDefault)
			throw new Error("provider model projection does not match the fixed provider catalogue");
		this._validateEmbeddingProjection(result, catalog?.embeddingModel?.slug ?? null);
		for (const projection of result.models)
		{
			const existing = await this.transaction.modelDefinition.findFirst({ where: { scope: "Global", clusterTenant: null, publicModelName: projection.publicModelName } });
			if (existing === null)
			{
				await this.transaction.modelDefinition.create({ data: { scope: "Global", clusterTenant: null, publicModelName: projection.publicModelName, upstreamModel: projection.upstreamModel, litellmModelId: projection.litellmModelId, apiBase: null, isDefault: false, providerCredentialId } });
				continue;
			}
			if (existing.upstreamModel !== projection.upstreamModel || existing.apiBase !== null)
				throw new Error(`provider model '${projection.publicModelName}' conflicts with its fixed catalogue projection`);
			await this.transaction.modelDefinition.update({ where: { id: existing.id }, data: { litellmModelId: projection.litellmModelId, providerCredentialId } });
		}
		const selectedDefaults = await this.transaction.modelDefinition.findMany({ where: { scope: "Global", clusterTenant: null, isDefault: true }, orderBy: { id: "asc" }, take: 2 });
		if (selectedDefaults.length > 1)
			throw new Error("Global model catalogue contains more than one default");
		let selectedDefault = selectedDefaults[0] ?? null;
		if (selectedDefault === null && result.defaultPublicModelName !== null)
		{
			const candidate = await this.transaction.modelDefinition.findFirst({ where: { scope: "Global", clusterTenant: null, publicModelName: result.defaultPublicModelName } });
			if (candidate === null)
				throw new Error("provider default model projection is missing");
			selectedDefault = await this.transaction.modelDefinition.update({ where: { id: candidate.id }, data: { isDefault: true } });
		}
		if (selectedDefault !== null && await this.transaction.modelRoutingDefault.findFirst({ where: { scope: "Global", clusterTenant: null } }) === null)
			await this.transaction.modelRoutingDefault.create({ data: { scope: "Global", clusterTenant: null, defaultModel: selectedDefault.publicModelName } });
	}

	/** Validates durable embedding evidence against the same fixed provider catalogue. */
	private _validateEmbeddingProjection(result: Extract<ProviderEffectHandlerResult, { readonly kind: ProviderEffectCommandKinds.SetByokKey }>, embeddingSlug: string | null): void
	{
		if (embeddingSlug === null)
		{
			if (result.embedding.status !== ProviderEmbeddingReconciliationStatuses.NotApplicable || result.embedding.deployments.length !== 0)
				throw new Error("provider embedding projection must be not-applicable");
			return;
		}
		if (result.embedding.status === ProviderEmbeddingReconciliationStatuses.Skipped && result.litellmCredentialName === null)
			return;
		if (result.embedding.status !== ProviderEmbeddingReconciliationStatuses.Confirmed)
			throw new Error("provider embedding projection lacks confirmed deployment evidence");
		const expected = [{ publicModelName: embeddingSlug, upstreamModel: embeddingSlug }, { publicModelName: "auto-embedding", upstreamModel: embeddingSlug }];
		const actual = result.embedding.deployments.map(function _Deployment(deployment) { return { publicModelName: deployment.publicModelName, upstreamModel: deployment.upstreamModel }; });
		if (JSON.stringify(actual) !== JSON.stringify(expected) || result.embedding.deployments.some(function _Invalid(deployment) { return deployment.litellmModelId.length === 0 || deployment.litellmModelId.startsWith("placeholder:"); }))
			throw new Error("provider embedding projection does not match confirmed catalogue deployments");
	}

	/** @inheritdoc */
	async fail(command: ProviderEffectCommandRecord, failureCode: string): Promise<ProviderEffectExecutionStatuses>
	{
		const currentDesired = await this._current(command.siloId, command.resourceKind, command.resourceId);
		if (currentDesired === null || currentDesired.id !== command.id || currentDesired.desiredGeneration !== command.desiredGeneration)
		{
			await this._terminalizeRecord(command, "superseded", new Date());
			return ProviderEffectExecutionStatuses.Failed;
		}
		const terminal = command.deliveryCount >= _MAX_DELIVERIES;
		let state: ProviderEffectCommandState = ProviderEffectCommandState.Pending;
		let status = ProviderEffectExecutionStatuses.Retryable;
		if (terminal)
		{
			state = ProviderEffectCommandState.Failed;
			status = ProviderEffectExecutionStatuses.Failed;
		}
		else if (command.materialRequirement === ProviderEffectMaterialRequirements.EphemeralProviderKey)
		{
			state = ProviderEffectCommandState.AwaitingMaterial;
			status = ProviderEffectExecutionStatuses.AwaitingMaterial;
		}
		const updated = await this.transaction.providerEffectCommand.updateMany({ where: { id: command.id, state: ProviderEffectCommandState.Claimed, claimFence: command.claimFence, deliveryCount: command.deliveryCount }, data: { state, failureCode, claimFence: null, claimExpiresAt: null, completedAt: terminal ? new Date() : null } });
		return updated.count === 1 ? status : ProviderEffectExecutionStatuses.Busy;
	}

	/** @inheritdoc */
	async retainClaim(command: ProviderEffectCommandRecord, failureCode: string): Promise<ProviderEffectExecutionStatuses>
	{
		const updated = await this.transaction.providerEffectCommand.updateMany({ where: { id: command.id, state: ProviderEffectCommandState.Claimed, claimFence: command.claimFence, deliveryCount: command.deliveryCount }, data: { failureCode } });
		return updated.count === 1 ? ProviderEffectExecutionStatuses.Retryable : ProviderEffectExecutionStatuses.Busy;
	}

	/** Loads the newest monotonic desired state for one governed resource. */
	private _current(siloId: string, resourceKind: string, resourceId: string): Promise<Prisma.ProviderEffectCommandGetPayload<Record<string, never>> | null>
	{
		return this.transaction.providerEffectCommand.findFirst({ where: { siloId, resourceKind, resourceId }, orderBy: { desiredGeneration: "desc" } });
	}

	/** Confirms this command is current and its owning product row still matches admitted intent. */
	private async _isCurrentAndEligible(command: Prisma.ProviderEffectCommandGetPayload<Record<string, never>>): Promise<boolean>
	{
		const current = await this._current(command.siloId, command.resourceKind, command.resourceId);
		if (current === null || current.id !== command.id || current.desiredGeneration !== command.desiredGeneration)
			return false;
		const payload = _ParseProviderEffectCommandPayload(command.kind as ProviderEffectCommandKinds, command.payload);
		if (payload.kind !== ProviderEffectCommandKinds.RegisterModel)
			return true;
		const model = await this.transaction.modelDefinition.findUnique({ where: { id: payload.value.modelDefinitionId }, include: { providerCredential: true } });
		if (model === null)
			return false;
		const expectedScope = payload.value.scope === "clusterTenant" ? "ClusterTenant" : "Global";
		return model.scope === expectedScope
			&& model.clusterTenant === payload.value.clusterTenant
			&& model.publicModelName === payload.value.publicModelName
			&& model.upstreamModel === payload.value.upstreamModel
			&& model.apiBase === payload.value.apiBase
			&& model.litellmModelId === `pending:${command.id}`
			&& (model.providerCredential?.secretRef ?? null) === payload.value.apiKeyEnvRef
			&& (model.providerCredential?.litellmCredentialName ?? null) === payload.value.litellmCredentialName;
	}

	/** Marks a stale Prisma row terminal so it cannot be retried after authority or intent changes. */
	private async _terminalize(command: Prisma.ProviderEffectCommandGetPayload<Record<string, never>>, failureCode: string, now: Date): Promise<void>
	{
		await this.transaction.providerEffectCommand.updateMany({ where: { id: command.id, state: command.state, updatedAt: command.updatedAt }, data: { state: ProviderEffectCommandState.Failed, failureCode, claimFence: null, claimExpiresAt: null, completedAt: now } });
	}

	/** Marks one claimed typed record terminal after a newer resource generation wins. */
	private async _terminalizeRecord(command: ProviderEffectCommandRecord, failureCode: string, now: Date): Promise<void>
	{
		await this.transaction.providerEffectCommand.updateMany({ where: { id: command.id, state: ProviderEffectCommandState.Claimed, claimFence: command.claimFence, deliveryCount: command.deliveryCount }, data: { state: ProviderEffectCommandState.Failed, failureCode, claimFence: null, claimExpiresAt: null, completedAt: now } });
	}
}

/** Re-admit the saved subject through current grants using only the trusted delivery actor. */
async function _isAuthorized(command: Prisma.ProviderEffectCommandGetPayload<Record<string, never>>, context: ProviderEffectExecutionContext, authorization: AuthorizationAuthority, now: Date): Promise<boolean>
{
	const argumentsDigest = ___DigestCanonicalJson({ operation: "deliver-provider-effect", commandId: command.id, desiredGeneration: command.desiredGeneration, resourceKind: command.resourceKind, resourceId: command.resourceId, executorProfile: command.executorProfile } as JsonValue);
	const admission = await authorization.admitPrincipal({ siloId: command.siloId, principalId: command.principalId, actorKind: context.actorKind, actorId: context.actorId, resource: { kind: ProductAuthorizationResourceKinds.Organization, id: command.siloId }, action: ProductAuthorizationActions.Administer, argumentsDigest, nowEpochMs: now.getTime() });
	return admission.outcome === AuthorizationDecisionOutcomes.Allow && admission.evidence !== null;
}

/** Confirms request/system actor coordinates and the saved command name the same delivery. */
function _contextMatches(command: Prisma.ProviderEffectCommandGetPayload<Record<string, never>>, context: ProviderEffectExecutionContext): boolean
{
	const actorMatches = context.actorKind === "user" ? context.actorId === context.principalId : context.actorKind === "system" && context.actorId === context.executorProfile;
	return actorMatches && command.siloId === context.siloId && command.principalId === context.principalId && command.resourceKind === context.resourceKind && command.resourceId === context.resourceId && command.executorProfile === context.executorProfile;
}

/** Convert one Prisma row into the closed provider-command model. */
function _toRecord(row: Prisma.ProviderEffectCommandGetPayload<Record<string, never>>): ProviderEffectCommandRecord
{
	const kind = row.kind as ProviderEffectCommandKinds;
	const payload = _ParseProviderEffectCommandPayload(kind, row.payload);
	_ValidateProviderEffectCommandResourceBinding(payload, row.resourceKind, row.resourceId);
	return {
		id: row.id,
		siloId: row.siloId,
		principalId: row.principalId,
		payload,
		resourceKind: row.resourceKind,
		resourceId: row.resourceId,
		resourceRevision: row.resourceRevision,
		desiredGeneration: row.desiredGeneration,
		argumentsDigest: row.argumentsDigest as `sha256:${string}`,
		materialVerifier: row.materialVerifier as `sha256:${string}` | null,
		authorization: { decisionDigest: row.authorizationDecisionDigest as `sha256:${string}`, policyRevisionHash: row.authorizationPolicyRevisionHash as `sha256:${string}`, effectiveAuthorizationDigest: row.effectiveAuthorizationDigest as `sha256:${string}` },
		approvalId: row.approvalId,
		executorProfile: row.executorProfile,
		materialRequirement: row.materialRequirement as ProviderEffectMaterialRequirements,
		state: row.state as ProviderEffectCommandStates,
		deliveryCount: row.deliveryCount,
		claimFence: row.claimFence,
		claimExpiresAt: row.claimExpiresAt,
		failureCode: row.failureCode,
	};
}
