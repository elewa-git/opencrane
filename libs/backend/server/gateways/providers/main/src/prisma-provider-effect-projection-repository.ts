import type { Prisma } from "@prisma/client";

import { _BYOK_PROVIDER_CATALOG, ProviderEmbeddingReconciliationStatuses } from "@opencrane/backend/server/gateways/model-routing";
import { ProductAuthorizationResourceKinds, type ProductAuthorizationResourceLocator } from "@opencrane/models/authorization";

import { PrismaProviderByokRepository } from "./prisma-provider-byok-repository";
import { ProviderEffectCommandKinds, type ProviderEffectCommandRecord, type ProviderEffectHandlerResult } from "./provider-effect-command.types";
import type { ProviderEffectProjectionRepository } from "./provider-effect-projection.types";
import { _ByokProviderConnectionId } from "./provider-resource-identity";

/** Owns product eligibility and projection inside a provider-command transaction. */
export class PrismaProviderEffectProjectionRepository implements ProviderEffectProjectionRepository
{
	/** Transaction that owns every credential and model projection. */
	private readonly transaction: Prisma.TransactionClient;
	/** Provider retirement repository bound to the same finalization transaction. */
	private readonly byok: PrismaProviderByokRepository;

	/** Binds protected product reads and writes to the lifecycle owner's transaction. */
	constructor(transaction: Prisma.TransactionClient)
	{
		this.transaction = transaction;
		this.byok = new PrismaProviderByokRepository(transaction);
	}

	/** @inheritdoc */
	async isEligible(command: ProviderEffectCommandRecord): Promise<boolean>
	{
		const payload = command.payload;
		if (payload.kind === ProviderEffectCommandKinds.DeleteByokKey)
			return this.byok.isRetirementEligible(command.siloId, payload.value);
		if (payload.kind !== ProviderEffectCommandKinds.RegisterModel)
			return true;
		const model = await this.transaction.modelDefinition.findUnique({ where: { id_siloId: { id: payload.value.modelDefinitionId, siloId: command.siloId } }, include: { providerCredential: true } });
		if (model === null)
			return false;
		const expectedScope = payload.value.scope === "clusterTenant" ? "ClusterTenant" : "Global";
		const directModelMatches = model.scope === expectedScope
			&& model.clusterTenant === payload.value.clusterTenant
			&& model.publicModelName === payload.value.publicModelName
			&& model.upstreamModel === payload.value.upstreamModel
			&& model.apiBase === payload.value.apiBase
			&& model.litellmModelId === `pending:${command.id}`
			&& (model.providerCredential?.secretRef ?? null) === payload.value.apiKeyEnvRef
			&& (model.providerCredential?.litellmCredentialName ?? null) === payload.value.litellmCredentialName;
		if (!directModelMatches)
			return false;
		if (payload.value.routingDefaultId === null || payload.value.selectedModelDefinitionId === null)
			return payload.value.publicModelName !== "auto" && payload.value.publicModelName !== "auto-embedding";
		if (payload.value.publicModelName !== "auto" || payload.value.scope !== "global" || payload.value.clusterTenant !== null)
			return false;
		const routingDefault = await this.transaction.modelRoutingDefault.findUnique({ where: { id_siloId: { id: payload.value.routingDefaultId, siloId: command.siloId } } });
		const selected = await this.transaction.modelDefinition.findUnique({ where: { id_siloId: { id: payload.value.selectedModelDefinitionId, siloId: command.siloId } }, include: { providerCredential: true } });
		return routingDefault !== null
			&& routingDefault.scope === "Global"
			&& routingDefault.clusterTenant === null
			&& selected !== null
			&& !selected.litellmModelId.startsWith("pending:")
			&& routingDefault.defaultModel === selected.publicModelName
			&& model.upstreamModel === selected.upstreamModel
			&& model.apiBase === selected.apiBase
			&& model.providerCredentialId === selected.providerCredentialId
			&& payload.value.apiKeyEnvRef === (selected.providerCredential?.secretRef ?? null)
			&& payload.value.litellmCredentialName === (selected.providerCredential?.litellmCredentialName ?? null);
	}

	/** @inheritdoc */
	async persist(command: ProviderEffectCommandRecord, result: ProviderEffectHandlerResult): Promise<readonly ProductAuthorizationResourceLocator[]>
	{
		switch (result.kind)
		{
			case ProviderEffectCommandKinds.SetByokKey:
			{
				if (command.payload.kind !== ProviderEffectCommandKinds.SetByokKey || result.provider !== command.payload.value.provider || result.secretRef !== command.payload.value.secretRef || (result.litellmCredentialName !== null && result.litellmCredentialName !== command.payload.value.litellmCredentialName))
					throw new Error("provider credential projection does not match its claimed command");
				const where = { siloId: command.siloId, scope: "Global" as const, clusterTenant: null, provider: result.provider };
				const existing = await this.transaction.providerCredential.findFirst({ where });
				const providerConnectionId = _ByokProviderConnectionId(command.siloId, result.provider);
				if (command.resourceId !== providerConnectionId || (existing !== null && existing.id !== providerConnectionId))
					throw new Error("provider credential projection has a different governed identity");
				if (existing === null)
				{
					const credential = await this.transaction.providerCredential.create({ data: { id: providerConnectionId, ...where, secretRef: result.secretRef, litellmCredentialName: result.litellmCredentialName } });
					const modelResources = await this._persistProviderModels(command.siloId, result, credential.id);
					return [{ kind: ProductAuthorizationResourceKinds.ProviderConnection, id: providerConnectionId }, ...modelResources];
				}
				else
				{
					await this.transaction.providerCredential.update({ where: { id_siloId: { id: existing.id, siloId: command.siloId } }, data: { secretRef: result.secretRef, litellmCredentialName: result.litellmCredentialName } });
					const modelResources = await this._persistProviderModels(command.siloId, result, existing.id);
					return [{ kind: ProductAuthorizationResourceKinds.ProviderConnection, id: providerConnectionId }, ...modelResources];
				}
			}
			case ProviderEffectCommandKinds.DeleteByokKey:
				if (command.payload.kind !== ProviderEffectCommandKinds.DeleteByokKey || result.provider !== command.payload.value.provider)
					throw new Error("provider credential removal does not match its claimed command");
				await this.byok.persistRetirement(command.siloId, command.payload.value);
				return [];
			case ProviderEffectCommandKinds.RegisterModel:
			{
				if (command.payload.kind !== ProviderEffectCommandKinds.RegisterModel)
					throw new Error("model registration result belongs to a different provider command");
				const model = await this.transaction.modelDefinition.updateMany({ where: { id: command.payload.value.modelDefinitionId, siloId: command.siloId, litellmModelId: `pending:${command.id}` }, data: { litellmModelId: result.litellmModelId } });
				if (model.count !== 1)
					throw new Error("current model registration command lost its pending projection");
				return [];
			}
		}
	}

	/** Validates and saves only the provider-specific catalogue in this transaction. */
	private async _persistProviderModels(siloId: string, result: Extract<ProviderEffectHandlerResult, { readonly kind: ProviderEffectCommandKinds.SetByokKey }>, providerCredentialId: string): Promise<readonly ProductAuthorizationResourceLocator[]>
	{
		const catalog = _BYOK_PROVIDER_CATALOG[result.provider];
		const expected = [...(catalog?.models.map(function _Model(model) { return { publicModelName: model.slug, upstreamModel: model.slug }; }) ?? [])];
		const actual = result.models.map(function _Model(model) { return { publicModelName: model.publicModelName, upstreamModel: model.upstreamModel }; });
		if (JSON.stringify(actual) !== JSON.stringify(expected))
			throw new Error("provider model projection does not match the fixed provider catalogue");
		this._validateEmbeddingProjection(result, catalog?.embeddingModel?.slug ?? null);
		const resources: ProductAuthorizationResourceLocator[] = [];
		for (const projection of result.models)
		{
			const existing = await this.transaction.modelDefinition.findFirst({ where: { siloId, scope: "Global", clusterTenant: null, publicModelName: projection.publicModelName } });
			if (existing === null)
			{
				const created = await this.transaction.modelDefinition.create({ data: { siloId, scope: "Global", clusterTenant: null, publicModelName: projection.publicModelName, upstreamModel: projection.upstreamModel, litellmModelId: projection.litellmModelId, apiBase: null, isDefault: false, providerCredentialId } });
				resources.push({ kind: ProductAuthorizationResourceKinds.ModelDefinition, id: created.id });
				continue;
			}
			if (existing.upstreamModel !== projection.upstreamModel || existing.apiBase !== null)
				throw new Error(`provider model '${projection.publicModelName}' conflicts with its fixed catalogue projection`);
			await this.transaction.modelDefinition.update({ where: { id_siloId: { id: existing.id, siloId } }, data: { litellmModelId: projection.litellmModelId, providerCredentialId } });
			resources.push({ kind: ProductAuthorizationResourceKinds.ModelDefinition, id: existing.id });
		}
		return resources;
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
}
