/**
 * Publishes the first Global model-routing default without replacing operator-owned policy.
 *
 * Implemented by: `PrismaGlobalModelRoutingDefaultRepository` in
 * `prisma-global-model-routing-default-repository.ts`.
 * Called by: `_EnsureProviderModels` after it resolves the first catalogue default.
 */
export interface GlobalModelRoutingDefaultRepository
{
	/** Creates the first Global default or accepts the row committed by a concurrent writer. */
	ensureFirst(publicModelName: string): Promise<void>;
}
