import type { ProviderEmbeddingReconciliationStatuses } from "./provider-embedding-models";

/** Secret-free evidence for one confirmed embedding deployment. */
export interface ProviderEmbeddingDeploymentEvidence
{
	/** Public name installed in LiteLLM. */
	readonly publicModelName: string;
	/** Provider model behind the public name. */
	readonly upstreamModel: string;
	/** Exact LiteLLM deployment identifier. */
	readonly litellmModelId: string;
}

/** Typed embedding outcome returned to durable provider-effect finalization. */
export type ProviderEmbeddingReconciliationResult =
	| { readonly status: ProviderEmbeddingReconciliationStatuses.NotApplicable; readonly deployments: readonly [] }
	| { readonly status: ProviderEmbeddingReconciliationStatuses.Skipped; readonly deployments: readonly [] }
	| { readonly status: ProviderEmbeddingReconciliationStatuses.Confirmed; readonly deployments: readonly ProviderEmbeddingDeploymentEvidence[] };
