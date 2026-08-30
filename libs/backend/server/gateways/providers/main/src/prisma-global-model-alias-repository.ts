import { randomUUID } from "node:crypto";

import { Prisma } from "@prisma/client";

import type { AuthorizationAuthority } from "@opencrane/backend/server/iam/authorization";
import { AuthorizationDecisionOutcomes, ProductAuthorizationActions, ProductAuthorizationResourceKinds } from "@opencrane/models/authorization";
import { ModelRoutingScope, type AutoRoutingConfig } from "@opencrane/contracts";
import { ___DigestCanonicalJson, type JsonValue } from "@opencrane/util";
import { _BYOK_PROVIDER_CATALOG } from "@opencrane/backend/server/gateways/model-routing";

import { ProviderEffectAdmissionStatuses, ProviderEffectCommandKinds, ProviderEffectMaterialRequirements, type ProviderEffectCommandOwner, type ProviderEffectCommandRecord, type ProviderEffectCommandRepository, type ProviderEffectExecutionContext, type ProviderEffectHandlerResult, type ProviderGlobalModelAliasRepository, type ProviderGlobalRoutingDefaultResult } from "./provider-effect-command.types";
import { _ParseProviderEffectCommandPayload } from "./provider-effect-command.validator";
import { ProviderEffectFinalizationBlockedError } from "./provider-effect-command-errors";

/** Public name reserved for the one global chat-model alias. */
export const _GLOBAL_AUTO_MODEL_NAME = "auto";
/** Public name reserved for the separately governed embedding alias. */
export const _GLOBAL_AUTO_EMBEDDING_MODEL_NAME = "auto-embedding";

/**
 * Creates the one durable RegisterModel child that reconciles the selected global model alias.
 *
 * The caller owns the surrounding Serializable transaction. This class may project only the
 * routing selection, reserved alias intent, and its authorization-bound child; it never calls
 * LiteLLM and never chooses a provider independently from `ModelRoutingDefault`.
 *
 * Called by: {@link PrismaProviderEffectCommandRepository.complete} after Set-BYOK projections.
 */
export class PrismaGlobalModelAliasRepository implements ProviderGlobalModelAliasRepository
{
	/** Transaction that owns selection, alias intent, and child admission together. */
	private readonly transaction: Prisma.TransactionClient;
	/** Transaction-scoped provider command repository used for child admission. */
	private readonly effects: Pick<ProviderEffectCommandRepository, "admit" | "findResourceBlocker" | "findFollowUpCandidate">;

	/** Binds global alias reconciliation to the caller's finalization transaction. */
	constructor(transaction: Prisma.TransactionClient, effects: Pick<ProviderEffectCommandRepository, "admit" | "findResourceBlocker" | "findFollowUpCandidate">)
	{
		this.transaction = transaction;
		this.effects = effects;
	}

	/** @inheritdoc */
	async reconcileGlobalRoutingDefault(owner: ProviderEffectCommandOwner, defaultModel: string, autoConfig: AutoRoutingConfig | null, context: ProviderEffectExecutionContext, authorization: AuthorizationAuthority, now: Date): Promise<ProviderGlobalRoutingDefaultResult>
	{
		const selected = await this.transaction.modelDefinition.findFirst({ where: { siloId: owner.siloId, scope: "Global", clusterTenant: null, publicModelName: defaultModel } });
		if (selected === null || selected.publicModelName === _GLOBAL_AUTO_MODEL_NAME || selected.publicModelName === _GLOBAL_AUTO_EMBEDDING_MODEL_NAME || selected.litellmModelId.startsWith("pending:"))
			throw new ProviderEffectFinalizationBlockedError();
		const argumentsDigest = ___DigestCanonicalJson({ operation: "upsert-global-model-routing-default", siloId: owner.siloId, defaultModel, autoConfig } as JsonValue);
		const admission = await authorization.admitPrincipal({ siloId: owner.siloId, principalId: owner.principalId, actorKind: context.actorKind, actorId: context.actorId, resource: { kind: ProductAuthorizationResourceKinds.Organization, id: owner.siloId }, action: ProductAuthorizationActions.Administer, argumentsDigest, nowEpochMs: now.getTime() });
		if (admission.outcome !== AuthorizationDecisionOutcomes.Allow || admission.evidence === null)
			throw new ProviderEffectFinalizationBlockedError();
		let routing = await this.transaction.modelRoutingDefault.findFirst({ where: { siloId: owner.siloId, scope: "Global", clusterTenant: null } });
		const autoConfigValue = autoConfig === null ? Prisma.JsonNull : autoConfig as unknown as Prisma.InputJsonValue;
		if (routing === null)
			routing = await this.transaction.modelRoutingDefault.create({ data: { siloId: owner.siloId, scope: "Global", clusterTenant: null, defaultModel, autoConfig: autoConfigValue } });
		else
			routing = await this.transaction.modelRoutingDefault.update({ where: { id_siloId: { id: routing.id, siloId: owner.siloId } }, data: { defaultModel, autoConfig: autoConfigValue } });
		const child = await this.reconcileRoutingDefault(owner, routing.id, context, authorization, now);
		return { value: { id: routing.id, scope: ModelRoutingScope.Global, clusterTenant: null, defaultModel: routing.defaultModel, autoConfig: routing.autoConfig as AutoRoutingConfig | null, createdAt: routing.createdAt.toISOString(), updatedAt: routing.updatedAt.toISOString() }, child };
	}

	/**
	 * Resolves the existing global selection or installs this provider's fixed default, then admits
	 * an exact child only when the reserved external alias differs from that same selection.
	 */
	async reconcileAfterSet(parent: ProviderEffectCommandRecord, result: Extract<ProviderEffectHandlerResult, { readonly kind: ProviderEffectCommandKinds.SetByokKey }>, context: ProviderEffectExecutionContext, authorization: AuthorizationAuthority, now: Date): Promise<ProviderEffectCommandRecord | null>
	{
		const catalog = _BYOK_PROVIDER_CATALOG[result.provider];
		const catalogDefault = catalog?.models.find(function _Default(model) { return model.className === catalog.defaultClass; })?.slug ?? null;
		if (catalogDefault === null)
			return null;

		// 1. Resolve one database-owned selection so provider setup order cannot create two alias owners.
		let routingDefault = await this.transaction.modelRoutingDefault.findFirst({ where: { siloId: parent.siloId, scope: "Global", clusterTenant: null } });
		let selectedName = routingDefault?.defaultModel ?? catalogDefault;
		let selected = await this.transaction.modelDefinition.findFirst({ where: { siloId: parent.siloId, scope: "Global", clusterTenant: null, publicModelName: selectedName }, include: { providerCredential: true } });
		if (selected === null || selected.publicModelName === _GLOBAL_AUTO_MODEL_NAME || selected.publicModelName === _GLOBAL_AUTO_EMBEDDING_MODEL_NAME || selected.litellmModelId.startsWith("pending:"))
			throw new ProviderEffectFinalizationBlockedError();
		if (routingDefault === null)
			routingDefault = await this.transaction.modelRoutingDefault.create({ data: { siloId: parent.siloId, scope: "Global", clusterTenant: null, defaultModel: selectedName } });
		else if (routingDefault.defaultModel === null)
		{
			routingDefault = await this.transaction.modelRoutingDefault.update({ where: { id_siloId: { id: routingDefault.id, siloId: parent.siloId } }, data: { defaultModel: selectedName } });
		}
		return this._reconcileSelection(parent, routingDefault, selected, context, authorization, now);
	}

	/** @inheritdoc */
	async reconcileRoutingDefault(owner: ProviderEffectCommandOwner, routingDefaultId: string, context: ProviderEffectExecutionContext, authorization: AuthorizationAuthority, now: Date): Promise<ProviderEffectCommandRecord | null>
	{
		const routingDefault = await this.transaction.modelRoutingDefault.findUnique({ where: { id_siloId: { id: routingDefaultId, siloId: owner.siloId } } });
		if (routingDefault === null || routingDefault.scope !== "Global" || routingDefault.clusterTenant !== null || routingDefault.defaultModel === null)
			throw new ProviderEffectFinalizationBlockedError();
		const selected = await this.transaction.modelDefinition.findFirst({ where: { siloId: owner.siloId, scope: "Global", clusterTenant: null, publicModelName: routingDefault.defaultModel }, include: { providerCredential: true } });
		if (selected === null || selected.publicModelName === _GLOBAL_AUTO_MODEL_NAME || selected.publicModelName === _GLOBAL_AUTO_EMBEDDING_MODEL_NAME || selected.litellmModelId.startsWith("pending:"))
			throw new ProviderEffectFinalizationBlockedError();
		return this._reconcileSelection(owner, routingDefault, selected, context, authorization, now);
	}

	/** Admits the exact reserved alias target selected by one silo routing-default row. */
	private async _reconcileSelection(owner: ProviderEffectCommandOwner, routingDefault: Prisma.ModelRoutingDefaultGetPayload<Record<string, never>>, selected: Prisma.ModelDefinitionGetPayload<{ include: { providerCredential: true } }>, context: ProviderEffectExecutionContext, authorization: AuthorizationAuthority, now: Date): Promise<ProviderEffectCommandRecord | null>
	{
		const existingAlias = await this.transaction.modelDefinition.findFirst({ where: { siloId: owner.siloId, scope: "Global", clusterTenant: null, publicModelName: _GLOBAL_AUTO_MODEL_NAME } });
		if (existingAlias !== null && !existingAlias.litellmModelId.startsWith("pending:") && existingAlias.upstreamModel === selected.upstreamModel && existingAlias.apiBase === selected.apiBase && existingAlias.providerCredentialId === selected.providerCredentialId)
			return null;
		const aliasId = existingAlias?.id ?? randomUUID();
		const blocker = await this.effects.findResourceBlocker(owner.siloId, ProductAuthorizationResourceKinds.ModelDefinition, aliasId);
		if (blocker !== null)
		{
			if (existingAlias !== null && await this._pendingAliasMatches(existingAlias.litellmModelId, blocker.commandId, owner, routingDefault.id, selected.id, selected.upstreamModel, selected.apiBase, selected.providerCredential?.secretRef ?? null, selected.providerCredential?.litellmCredentialName ?? null))
			{
				const shared = await this.effects.findFollowUpCandidate(owner, blocker.commandId);
				if (shared === null)
					throw new ProviderEffectFinalizationBlockedError();
				return shared;
			}
			throw new ProviderEffectFinalizationBlockedError();
		}

		// 3. Admit the exact alias target before any post-commit LiteLLM call can observe it.
		const commandId = randomUUID();
		const desiredAlias = { aliasId, publicModelName: _GLOBAL_AUTO_MODEL_NAME, upstreamModel: selected.upstreamModel, apiBase: selected.apiBase, providerCredentialId: selected.providerCredentialId, apiKeyEnvRef: selected.providerCredential?.secretRef ?? null, litellmCredentialName: selected.providerCredential?.litellmCredentialName ?? null, routingDefaultId: routingDefault.id, selectedModelDefinitionId: selected.id, generatedOutputCapabilities: selected.generatedOutputCapabilities, executorProfile: owner.executorProfile } as JsonValue;
		const resourceRevision = ___DigestCanonicalJson(desiredAlias);
		const argumentsDigest = ___DigestCanonicalJson({ operation: "register-global-auto", commandId, resourceRevision, desiredAlias } as JsonValue);
		const admission = await authorization.admitPrincipal({ siloId: owner.siloId, principalId: owner.principalId, actorKind: context.actorKind, actorId: context.actorId, resource: { kind: ProductAuthorizationResourceKinds.Organization, id: owner.siloId }, action: ProductAuthorizationActions.Administer, argumentsDigest, nowEpochMs: now.getTime() });
		if (admission.outcome !== AuthorizationDecisionOutcomes.Allow || admission.evidence === null)
			throw new ProviderEffectFinalizationBlockedError();
		const pendingId = `pending:${commandId}`;
		if (existingAlias === null)
		{
			await this.transaction.modelDefinition.create({ data: { id: aliasId, siloId: owner.siloId, scope: "Global", clusterTenant: null, publicModelName: _GLOBAL_AUTO_MODEL_NAME, upstreamModel: selected.upstreamModel, litellmModelId: pendingId, apiBase: selected.apiBase, isDefault: false, providerCredentialId: selected.providerCredentialId, generatedOutputCapabilities: selected.generatedOutputCapabilities } });
		}
		else
		{
			await this.transaction.modelDefinition.update({ where: { id_siloId: { id: aliasId, siloId: owner.siloId } }, data: { upstreamModel: selected.upstreamModel, litellmModelId: pendingId, apiBase: selected.apiBase, isDefault: false, providerCredentialId: selected.providerCredentialId, generatedOutputCapabilities: selected.generatedOutputCapabilities } });
		}
		const payload = { kind: ProviderEffectCommandKinds.RegisterModel, value: { modelDefinitionId: aliasId, publicModelName: _GLOBAL_AUTO_MODEL_NAME, upstreamModel: selected.upstreamModel, scope: ModelRoutingScope.Global, clusterTenant: null, apiBase: selected.apiBase, apiKeyEnvRef: selected.providerCredential?.secretRef ?? null, litellmCredentialName: selected.providerCredential?.litellmCredentialName ?? null, routingDefaultId: routingDefault.id, selectedModelDefinitionId: selected.id } } as const;
		const admitted = await this.effects.admit({ id: commandId, siloId: owner.siloId, principalId: owner.principalId, payload, resourceKind: ProductAuthorizationResourceKinds.ModelDefinition, resourceId: aliasId, resourceRevision, argumentsDigest, materialVerifier: null, authorization: admission.evidence, approvalId: null, executorProfile: owner.executorProfile, materialRequirement: ProviderEffectMaterialRequirements.None });
		if (admitted.status !== ProviderEffectAdmissionStatuses.Admitted)
			throw new ProviderEffectFinalizationBlockedError();
		return admitted.command;
	}

	/** Confirms an active child already owns these exact selected alias coordinates. */
	private async _pendingAliasMatches(pendingModelId: string, blockerCommandId: string, parent: ProviderEffectCommandOwner, routingDefaultId: string, selectedModelDefinitionId: string, upstreamModel: string, apiBase: string | null, apiKeyEnvRef: string | null, litellmCredentialName: string | null): Promise<boolean>
	{
		if (pendingModelId !== `pending:${blockerCommandId}`)
			return false;
		const child = await this.transaction.providerEffectCommand.findUnique({ where: { id: blockerCommandId } });
		if (child === null || child.siloId !== parent.siloId || child.executorProfile !== parent.executorProfile || child.kind !== ProviderEffectCommandKinds.RegisterModel || child.resourceKind !== ProductAuthorizationResourceKinds.ModelDefinition)
			return false;
		const payload = _ParseProviderEffectCommandPayload(ProviderEffectCommandKinds.RegisterModel, child.payload);
		if (payload.kind !== ProviderEffectCommandKinds.RegisterModel)
			return false;
		return payload.value.modelDefinitionId === child.resourceId
			&& payload.value.publicModelName === _GLOBAL_AUTO_MODEL_NAME
			&& payload.value.routingDefaultId === routingDefaultId
			&& payload.value.selectedModelDefinitionId === selectedModelDefinitionId
			&& payload.value.upstreamModel === upstreamModel
			&& payload.value.apiBase === apiBase
			&& payload.value.apiKeyEnvRef === apiKeyEnvRef
			&& payload.value.litellmCredentialName === litellmCredentialName;
	}
}
