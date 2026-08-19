import type { Logger } from "pino";

import { ModelRoutingScope } from "@opencrane/contracts";

import type { ByokProviderCatalog } from "./byok-default-models.types";
import { _ReadLiteLlmModelDeployments } from "./litellm-model-inventory";
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
 * outside that table. The provider slug and stable alias both use embedding mode. A registration
 * that finds either deployment already present leaves that deployment in place; reading it from
 * the live inventory also qualifies it during startup without creating a duplicate deployment.
 *
 * Called by: `_ProvisionByokKey` in `provision-byok-key.ts`.
 *
 * @param catalog - Provider catalogue, or undefined for an uncatalogued provider.
 * @param litellmCredentialName - LiteLLM credential name, or null for a Secret-only baseline.
 * @param log - Scoped logger for registration outcomes.
 * @param requireLiveModels - Propagates registration failures for names missing from the live
 * inventory during startup qualification.
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
	const registered = await _ReadLiteLlmRegisteredModelNames(endpoint, masterKey, log, requireLiveModels);
	for (const deployment of deployments)
	{
		if (registered.has(deployment.publicModelName))
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
 * Reads registered LiteLLM model names and falls back only for interactive reconciliation.
 *
 * @param endpoint - LiteLLM endpoint without a route suffix.
 * @param masterKey - LiteLLM administrative bearer token.
 * @param log - Scoped logger that records why registration idempotency could not be checked.
 * @param requireLiveModels - Propagates inventory failures during strict startup qualification.
 * @returns Validated registered model names, or an empty set when the inventory cannot be read.
 * @throws When strict startup cannot read or validate the inventory.
 */
async function _ReadLiteLlmRegisteredModelNames(endpoint: string, masterKey: string, log: Logger, requireLiveModels: boolean): Promise<Set<string>>
{
	try
	{
		return new Set((await _ReadLiteLlmModelDeployments(endpoint, masterKey)).keys());
	}
	catch (err)
	{
		if (requireLiveModels) throw err;
		log.warn({ operation: "litellm.embedding.inventory", err }, "embedding model inventory read failed; registration will be reconciled");
		return new Set();
	}
}
