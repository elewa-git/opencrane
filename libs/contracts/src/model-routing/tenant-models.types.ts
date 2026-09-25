/**
 * Which models one tenant may use — the body of the internal tenant-models endpoint
 * (`GET /api/internal/tenant-models/:tenant`).
 *
 * The clustertenant-manager produces it; the fleet-manager's tenant reconcile
 * consumes it to scope the tenant's LiteLLM virtual-key `models[]` allowlist and
 * seed its fallback routing. A read-only, best-effort projection over the model
 * registry — it carries no secret material. A `null` result on the consumer side
 * (any fetch failure, non-200, or missing URL) signals callers to fall back to the
 * unrestricted default behaviour.
 */
export interface TenantModelSet
{
  /**
   * De-duplicated `publicModelName`s the tenant may use: all Global models plus
   * any ClusterTenant-scoped models bound to the tenant's ClusterTenant. May be empty.
   */
  models: string[];

  /**
   * The tenant's effective default model `publicModelName`, or null when no
   * default resolves anywhere in the precedence chain.
   */
  defaultModel: string | null;
}
