/**
 * Carries the persisted Global credential identity and LiteLLM registration status back to BYOK
 * provisioning without exposing raw key material or the Prisma row.
 *
 * Called by: `_ProvisionByokKey`, which returns this projection and passes its `id` to
 * `_EnsureProviderModels` after custody writes succeed.
 * @see {@link GlobalProviderCredentialProjectionRepository.upsertGlobal}
 */
export interface GlobalProviderCredentialProjection
{
	/** Stable database identity referenced by provider-backed model definitions. */
	readonly id: string;
	/** LiteLLM credential name, or null until registration succeeds. */
	readonly litellmCredentialName: string | null;
	/** Latest projection refresh timestamp for status reporting. */
	readonly updatedAt: Date;
}

/**
 * Carries the custody references that replace one Global provider projection after the Secret and
 * LiteLLM operations complete. It cannot carry the raw provider key across the repository boundary.
 *
 * Called by: `_ProvisionByokKey`, which builds this command after external custody changes.
 * @see {@link GlobalProviderCredentialProjectionRepository.upsertGlobal}
 */
export interface UpsertGlobalProviderCredentialCommand
{
	/** Stable provider identifier whose one Global projection is reconciled. */
	readonly provider: string;
	/** Fixed Kubernetes Secret name containing the provider key. */
	readonly secretRef: string;
	/** LiteLLM credential name, or null until LiteLLM accepts the key. */
	readonly litellmCredentialName: string | null;
}

/**
 * Persists the database projection of provider-key custody without receiving raw key material.
 *
 * Implemented by: `PrismaGlobalProviderCredentialProjectionRepository` in
 * `prisma-provider-credential-projection-repository.ts`.
 * Called by: `_ProvisionByokKey` and `_DeprovisionByokKey` after external custody changes.
 */
export interface GlobalProviderCredentialProjectionRepository
{
	/** Creates or refreshes the provider's one Global projection and converges concurrent creates. */
	upsertGlobal(command: UpsertGlobalProviderCredentialCommand): Promise<GlobalProviderCredentialProjection>;
	/** Deletes the provider's Global projection after its external custody copies are removed. */
	deleteGlobal(provider: string): Promise<void>;
}
