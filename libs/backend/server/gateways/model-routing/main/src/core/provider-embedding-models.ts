import type { Logger } from "pino";

import { ModelRoutingScope } from "@opencrane/contracts";

import type { ByokProviderCatalog } from "./byok-default-models.types";
import { _RegisterLiteLlmModel } from "./litellm-model-registration";
import type { ProviderEmbeddingDeploymentEvidence, ProviderEmbeddingReconciliationResult } from "./provider-embedding-models.types";

/** Closed outcomes for provider embedding reconciliation. */
export enum ProviderEmbeddingReconciliationStatuses
{
	/** The provider catalogue has no embedding model. */
	NotApplicable = "not_applicable",
	/** LiteLLM is not configured, so no external deployment was attempted. */
	Skipped = "skipped",
	/** Both fixed embedding deployments were applied or fully confirmed. */
	Confirmed = "confirmed",
}

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
 * Called by: provider effect delivery and `_ProvisionByokKey` startup bootstrap.
 *
 * @param catalog - Provider catalogue, or undefined for an uncatalogued provider.
 * @param litellmCredentialName - LiteLLM credential name, or null for a Secret-only baseline.
 * @param log - Scoped logger for registration outcomes.
 * @returns A closed, secret-free outcome with exact evidence for every confirmed deployment.
 * @throws When configured LiteLLM cannot qualify or reconcile either required deployment.
 */
export async function _EnsureProviderEmbeddingModels(catalog: ByokProviderCatalog | undefined, litellmCredentialName: string | null, log: Logger): Promise<ProviderEmbeddingReconciliationResult>
{
	if (!catalog?.embeddingModel)
		return { status: ProviderEmbeddingReconciliationStatuses.NotApplicable, deployments: [] };
	const endpoint = process.env.LITELLM_ENDPOINT?.trim() ?? "";
	const masterKey = process.env.LITELLM_MASTER_KEY?.trim() ?? "";
	if (!endpoint || !masterKey)
		return { status: ProviderEmbeddingReconciliationStatuses.Skipped, deployments: [] };

	const slug = catalog.embeddingModel.slug;
	const deployments = [
		{ publicModelName: slug, upstreamModel: slug },
		{ publicModelName: _AUTO_EMBEDDING_MODEL_NAME, upstreamModel: slug },
	];
	const evidence: ProviderEmbeddingDeploymentEvidence[] = [];
	for (const deployment of deployments)
	{
		const litellmModelId = await _RegisterLiteLlmModel({
			publicModelName: deployment.publicModelName,
			upstreamModel: deployment.upstreamModel,
			scope: ModelRoutingScope.Global,
			clusterTenant: null,
			apiBase: null,
			apiKeyEnvRef: null,
			litellmCredentialName,
			mode: "embedding",
			requireLiveRegistration: true,
		});
		evidence.push({ ...deployment, litellmModelId });
		log.info({ publicModelName: deployment.publicModelName, upstreamModel: deployment.upstreamModel }, "embedding model registered with litellm");
	}
	return { status: ProviderEmbeddingReconciliationStatuses.Confirmed, deployments: evidence };
}
