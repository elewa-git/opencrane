import { createHash } from "node:crypto";

import * as k8s from "@kubernetes/client-node";

import { ModelRoutingScope } from "@opencrane/contracts";
import { _ApplyProviderKeySecret, _BYOK_PROVIDER_CATALOG, _byokCredentialName, _byokSecretName, _ClearProviderKeySecret, _DeleteLiteLlmCredential, _EnsureProviderEmbeddingModels, _RegisterLiteLlmModel, _UpsertLiteLlmCredential, LiteLlmCredentialMutationOutcomes, type ByokProviderCatalog } from "@opencrane/backend/server/gateways/model-routing";

import { _log } from "./log";
import { ProviderEffectOutcomeUncertainError } from "./provider-effect-command-errors";
import { ProviderEffectCommandKinds, type ProviderEffectCommandHandler, type ProviderEffectCommandRecord, type ProviderEffectEphemeralMaterial, type ProviderEffectHandlerResult, type ProviderEffectModelProjection } from "./provider-effect-command.types";

/**
 * Performs Kubernetes and LiteLLM work for a command whose database claim already committed.
 *
 * The handler has no authorization API. It can act only on the closed payload loaded from a claimed
 * command. Raw provider material enters through the method argument, is never logged, and is never
 * copied into command persistence.
 *
 * Called by: {@link DefaultProviderEffectCommandExecutor} in provider route composition.
 */
export class DefaultProviderEffectCommandHandler implements ProviderEffectCommandHandler
{
	/** Kubernetes API used for the fixed provider Secret catalogue. */
	private readonly coreApi: k8s.CoreV1Api | null;
	/** Namespace that contains the fixed provider Secret catalogue. */
	private readonly operatorNamespace: string | null;

	/**
	 * Binds command delivery to the existing provider-custody and model-registration adapters.
	 *
	 * @param coreApi - Kubernetes client restricted to fixed BYOK Secret names.
	 * @param operatorNamespace - Namespace that owns those Secrets.
	 */
	constructor(coreApi: k8s.CoreV1Api | null = null, operatorNamespace: string | null = null)
	{
		this.coreApi = coreApi;
		this.operatorNamespace = operatorNamespace;
	}

	/** @inheritdoc */
	async execute(command: ProviderEffectCommandRecord, material: ProviderEffectEphemeralMaterial): Promise<ProviderEffectHandlerResult>
	{
		switch (command.payload.kind)
		{
			case ProviderEffectCommandKinds.SetByokKey:
			{
				if (this.coreApi === null || this.operatorNamespace === null)
					throw new Error("Set-BYOK execution requires the Kubernetes custody adapter");
				const providerKey = material.providerKey?.trim() ?? "";
				if (material.provider !== command.payload.value.provider || providerKey.length === 0)
					throw new Error("Set-BYOK execution requires matching ephemeral provider material");
				const value = command.payload.value;
				_requireFixedCustodyCoordinates(value.provider, value.secretRef, value.litellmCredentialName);
				await _ApplyProviderKeySecret(this.coreApi, this.operatorNamespace, value.provider, providerKey);
				const credentialOutcome = await _UpsertLiteLlmCredential({ credentialName: value.litellmCredentialName, provider: value.provider, apiKey: providerKey });
				const requireLiveRegistration = _litellmConfigured();
				if (requireLiveRegistration && credentialOutcome !== LiteLlmCredentialMutationOutcomes.Applied)
					throw new ProviderEffectOutcomeUncertainError();
				const litellmCredentialName = credentialOutcome === LiteLlmCredentialMutationOutcomes.Applied ? value.litellmCredentialName : null;
				const catalog = _BYOK_PROVIDER_CATALOG[value.provider];
				try
				{
					const models = await _registerProviderModels(catalog, litellmCredentialName, requireLiveRegistration);
					const embedding = await _EnsureProviderEmbeddingModels(catalog, litellmCredentialName, _log);
					const defaultPublicModelName = catalog?.models.find(model => model.className === catalog.defaultClass)?.slug ?? null;
					return { kind: command.payload.kind, provider: value.provider, secretRef: value.secretRef, litellmCredentialName, models, defaultPublicModelName, embedding };
				}
				catch
				{
					throw new ProviderEffectOutcomeUncertainError();
				}
			}
			case ProviderEffectCommandKinds.DeleteByokKey:
			{
				if (this.coreApi === null || this.operatorNamespace === null)
					throw new Error("Delete-BYOK execution requires the Kubernetes custody adapter");
				const value = command.payload.value;
				_requireFixedCustodyCoordinates(value.provider, value.secretRef, value.litellmCredentialName);
				await _ClearProviderKeySecret(this.coreApi, this.operatorNamespace, value.provider);
				const credentialOutcome = await _DeleteLiteLlmCredential(value.litellmCredentialName);
				if (credentialOutcome !== LiteLlmCredentialMutationOutcomes.Applied && credentialOutcome !== LiteLlmCredentialMutationOutcomes.Skipped)
					throw new ProviderEffectOutcomeUncertainError();
				return { kind: command.payload.kind, provider: value.provider };
			}
			case ProviderEffectCommandKinds.RegisterModel:
			{
				const value = command.payload.value;
				try
				{
					const litellmModelId = await _RegisterLiteLlmModel({ deploymentId: _modelDeploymentId(value.modelDefinitionId, value.publicModelName), publicModelName: value.publicModelName, upstreamModel: value.upstreamModel, scope: value.scope, clusterTenant: value.clusterTenant, apiBase: value.apiBase, apiKeyEnvRef: value.apiKeyEnvRef, litellmCredentialName: value.litellmCredentialName, requireLiveRegistration: true });
					return { kind: command.payload.kind, litellmModelId };
				}
				catch
				{
					throw new ProviderEffectOutcomeUncertainError();
				}
			}
		}
	}
}

/** Registers every chat deployment that the provider key must make usable before finalization. */
async function _registerProviderModels(catalog: ByokProviderCatalog | undefined, litellmCredentialName: string | null, requireLiveRegistration: boolean): Promise<readonly ProviderEffectModelProjection[]>
{
	if (catalog === undefined)
		return [];
	const models: ProviderEffectModelProjection[] = [];
	for (const entry of catalog.models)
	{
		const litellmModelId = await _RegisterLiteLlmModel({ deploymentId: _modelDeploymentId("global-provider-model", entry.slug), publicModelName: entry.slug, upstreamModel: entry.slug, scope: ModelRoutingScope.Global, clusterTenant: null, apiBase: null, apiKeyEnvRef: null, litellmCredentialName, requireLiveRegistration });
		models.push({ publicModelName: entry.slug, upstreamModel: entry.slug, litellmModelId });
	}
	const cheapest = catalog.models.find(model => model.className === "fast") ?? catalog.models[catalog.models.length - 1];
	if (cheapest !== undefined)
	{
		const litellmModelId = await _RegisterLiteLlmModel({ deploymentId: _modelDeploymentId("global-provider-model", "auto"), publicModelName: "auto", upstreamModel: cheapest.slug, scope: ModelRoutingScope.Global, clusterTenant: null, apiBase: null, apiKeyEnvRef: null, litellmCredentialName, requireLiveRegistration });
		models.push({ publicModelName: "auto", upstreamModel: cheapest.slug, litellmModelId });
	}
	return models;
}

/** Builds a replay-stable LiteLLM deployment id from the governed model resource. */
function _modelDeploymentId(resourceId: string, publicModelName: string): string
{
	const digest = createHash("sha256").update(resourceId).update("\0").update(publicModelName).digest("hex").slice(0, 32).split("");
	digest[12] = "5";
	digest[16] = ((Number.parseInt(digest[16] ?? "0", 16) & 0x3) | 0x8).toString(16);
	return `${digest.slice(0, 8).join("")}-${digest.slice(8, 12).join("")}-${digest.slice(12, 16).join("")}-${digest.slice(16, 20).join("")}-${digest.slice(20).join("")}`;
}

/** Returns whether failed LiteLLM calls may have changed the configured upstream service. */
function _litellmConfigured(): boolean
{
	return Boolean(process.env.LITELLM_ENDPOINT?.trim() && process.env.LITELLM_MASTER_KEY?.trim());
}

/** Refuse a command whose persisted custody coordinates differ from the fixed provider catalogue. */
function _requireFixedCustodyCoordinates(provider: string, secretRef: string, litellmCredentialName: string): void
{
	if (secretRef !== _byokSecretName(provider) || litellmCredentialName !== _byokCredentialName(provider))
		throw new Error("provider effect command contains invalid custody coordinates");
}
