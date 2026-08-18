import type { Logger } from "pino";

import { ModelRoutingScope } from "@opencrane/contracts";
import { ___ParseAndValidateJson } from "@opencrane/util";

import type { ByokProviderCatalog } from "./byok-default-models.types";
import { _RegisterLiteLlmModel } from "./litellm-model-registration";

/**
 * Public model name of the stable embedding selection.
 *
 * The configured provider's catalogued embedding model backs this alias. Cognee references the
 * alias instead of a provider slug, so an operator can re-point the backing model without changing
 * its consumer configuration.
 */
export const _AUTO_EMBEDDING_MODEL_NAME = "auto-embedding";

/**
 * Registers a provider's embedding model directly with LiteLLM without creating chat definitions.
 *
 * Every Global `ModelDefinition` is tenant-selectable, so embedding deployments deliberately stay
 * outside that table. The provider slug and stable alias both use embedding mode. The first
 * ordinary registration that finds either deployment already present leaves that deployment in
 * place; startup qualification re-registers both names so LiteLLM has to accept them live.
 *
 * Called by: `_ProvisionByokKey` in `provision-byok-key.ts`.
 *
 * @param catalog - Provider catalogue, or undefined for an uncatalogued provider.
 * @param litellmCredentialName - LiteLLM credential name, or null for a Secret-only baseline.
 * @param log - Scoped logger for registration outcomes.
 * @param requireLiveModels - Re-registers inventory matches and propagates registration failures
 * during startup qualification.
 * @returns After an uncatalogued or unconfigured provider is skipped, or both deployments have
 * been registered or confirmed present.
 * @throws When startup qualification requires live registration and LiteLLM rejects a deployment.
 */
export async function _EnsureProviderEmbeddingModels(catalog: ByokProviderCatalog | undefined, litellmCredentialName: string | null, log: Logger, requireLiveModels: boolean): Promise<void>
{
	if (!catalog?.embeddingModel) return;
	const endpoint = process.env.LITELLM_ENDPOINT?.trim() ?? "";
	const masterKey = process.env.LITELLM_MASTER_KEY?.trim() ?? "";
	if (!endpoint || !masterKey) return;

	const slug = catalog.embeddingModel.slug;
	const deployments = [
		{ publicModelName: slug, upstreamModel: slug },
		{ publicModelName: _AUTO_EMBEDDING_MODEL_NAME, upstreamModel: slug },
	];
	const registered = await _ReadLiteLlmRegisteredModelNames(endpoint, masterKey, log);
	for (const deployment of deployments)
	{
		if (registered.has(deployment.publicModelName) && !requireLiveModels)
		{
			log.debug({ publicModelName: deployment.publicModelName }, "embedding model already registered with litellm");
			continue;
		}
		await _RegisterLiteLlmModel({
			publicModelName: deployment.publicModelName,
			upstreamModel: deployment.upstreamModel,
			scope: ModelRoutingScope.Global,
			clusterTenant: null,
			apiBase: null,
			apiKeyEnvRef: null,
			litellmCredentialName,
			mode: "embedding",
			requireLiveRegistration: requireLiveModels,
		});
		log.info({ publicModelName: deployment.publicModelName, upstreamModel: deployment.upstreamModel }, "embedding model registered with litellm");
	}
}

/**
 * Reads registered LiteLLM model names and falls back to an empty set after logging read failures.
 *
 * @param endpoint - LiteLLM endpoint without a route suffix.
 * @param masterKey - LiteLLM administrative bearer token.
 * @param log - Scoped logger that records why registration idempotency could not be checked.
 * @returns Validated registered model names, or an empty set when the inventory cannot be read.
 */
async function _ReadLiteLlmRegisteredModelNames(endpoint: string, masterKey: string, log: Logger): Promise<Set<string>>
{
	try
	{
		const response = await fetch(`${endpoint}/model/info`, { headers: { Authorization: `Bearer ${masterKey}` } });
		if (!response.ok)
		{
			log.warn({ operation: "litellm.embedding.inventory", status: response.status }, "embedding model inventory read failed; registration will be reconciled");
			return new Set();
		}
		return ___ParseAndValidateJson(await response.text(), "LiteLLM model inventory response", _RegisteredModelNames);
	}
	catch (err)
	{
		log.warn({ operation: "litellm.embedding.inventory", err }, "embedding model inventory read failed; registration will be reconciled");
		return new Set();
	}
}

/**
 * Validates and collects the registered model names returned by LiteLLM.
 *
 * Called by: `_RequireLiteLlmModelRegistration` and the embedding inventory reader before either
 * flow decides whether registration work remains.
 *
 * @returns The distinct model names, or an empty set when LiteLLM omits `data`.
 * @throws When the inventory, its `data`, an entry, or a present `model_name` has the wrong shape.
 */
export function _RegisteredModelNames(value: unknown): Set<string>
{
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("LiteLLM model inventory must be an object");
	const data = (value as Record<string, unknown>)["data"];
	if (data === undefined) return new Set();
	if (!Array.isArray(data)) throw new Error("LiteLLM model inventory data must be an array");
	const names = data.map(function _Name(entry): string
	{
		if (typeof entry !== "object" || entry === null || Array.isArray(entry)) throw new Error("LiteLLM model inventory entry must be an object");
		const modelName = (entry as Record<string, unknown>)["model_name"];
		if (modelName === undefined) return "";
		if (typeof modelName !== "string") throw new Error("LiteLLM model inventory name must be a string");
		return modelName;
	});
	return new Set(names.filter(Boolean));
}
