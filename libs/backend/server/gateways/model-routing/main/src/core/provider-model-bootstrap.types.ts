import type { GlobalModelRoutingDefaultRepository } from "./global-model-routing-default-repository.types";
import type { ProviderModelEvidenceRepository } from "./provider-model-evidence-repository.types";

/**
 * Groups the model-evidence and first-default publication ports used by provider bootstrap without
 * giving the coordinator access to Prisma.
 *
 * Called by: `_ProvisionByokKey`, which supplies these repositories to `_EnsureProviderModels`.
 * @see {@link ProviderModelEvidenceRepository}
 * @see {@link GlobalModelRoutingDefaultRepository}
 */
export interface ProviderModelBootstrapRepositories
{
	/** Owns Global ModelDefinition persistence and AgentRevision evidence checks. */
	readonly models: ProviderModelEvidenceRepository;
	/** Owns first-writer publication of the Global routing default. */
	readonly routingDefaults: GlobalModelRoutingDefaultRepository;
}
