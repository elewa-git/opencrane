/**
 * Carries the model identity and binding fields that bootstrap uses to decide whether an existing
 * definition can be reconciled or must preserve a deployment frozen by AgentRevision evidence.
 *
 * Called by: `_EnsureProviderModels` and its reconciliation helpers after repository reads.
 * @see {@link ProviderModelEvidenceRepository.isReferencedByAgentRevision}
 */
export interface ProviderModelDefinition
{
	/** Stable model-definition identity frozen into AgentRevision evidence. */
	readonly id: string;
	/** Public routing name presented to model consumers. */
	readonly publicModelName: string;
	/** LiteLLM deployment identity that must remain stable once referenced. */
	readonly litellmModelId: string;
	/** Optional provider-compatible upstream base URL. */
	readonly apiBase: string | null;
	/** Provider credential projection that authorizes this model. */
	readonly providerCredentialId: string | null;
}

/**
 * Carries the deployment identity returned by model registration into one new Global
 * provider-backed model definition.
 *
 * Called by: `_EnsureProviderModels` and `_ensureSelectedModel` after registration returns an id.
 * @see {@link ProviderModelEvidenceRepository.createGlobal}
 */
export interface CreateGlobalProviderModelCommand
{
	/** Public routing name for the new definition. */
	readonly publicModelName: string;
	/** LiteLLM deployment identity, or a placeholder until live registration succeeds. */
	readonly litellmModelId: string;
	/** Upstream provider model used by the LiteLLM deployment. */
	readonly upstreamModel: string;
	/** Optional upstream base URL. */
	readonly apiBase: string | null;
	/** Whether this definition starts as the legacy catalogue default. */
	readonly isDefault: boolean;
	/** Global provider credential projection that authorizes the definition. */
	readonly providerCredentialId: string;
}

/**
 * Limits bootstrap reconciliation to the credential binding, deployment identity, and legacy
 * default flag. The coordinator permits deployment replacement only for an unreferenced placeholder.
 *
 * Called by: `_EnsureProviderModels` and `_qualifyOrReconcileModelDefinition`.
 * @see {@link ProviderModelEvidenceRepository.update}
 */
export interface UpdateProviderModelCommand
{
	/** Provider projection to bind after a non-live repair. */
	readonly providerCredentialId?: string;
	/** Replacement deployment identity for an unreferenced placeholder. */
	readonly litellmModelId?: string;
	/** Whether the definition becomes the first legacy catalogue default. */
	readonly isDefault?: boolean;
}

/**
 * Owns ModelDefinition persistence and the AgentRevision evidence check used during bootstrap.
 *
 * Implemented by: `PrismaProviderModelEvidenceRepository` in
 * `prisma-provider-model-evidence-repository.ts`.
 * Called by: `_EnsureProviderModels` in `provider-model-bootstrap.ts`.
 */
export interface ProviderModelEvidenceRepository
{
	/** Finds one Global definition by its public routing name. */
	findGlobalByPublicName(publicModelName: string): Promise<ProviderModelDefinition | null>;
	/** Lists at most two Global definitions claiming the legacy catalogue default. */
	listGlobalDefaults(): Promise<readonly ProviderModelDefinition[]>;
	/** Creates one Global definition after registration returns a live or placeholder deployment id. */
	createGlobal(command: CreateGlobalProviderModelCommand): Promise<ProviderModelDefinition>;
	/** Applies one reviewed mutable reconciliation patch. */
	update(id: string, command: UpdateProviderModelCommand): Promise<ProviderModelDefinition>;
	/** Reports whether an immutable AgentRevision already references the definition. */
	isReferencedByAgentRevision(id: string): Promise<boolean>;
}
