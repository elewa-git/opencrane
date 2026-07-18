/**
 * Specification for a Tenant custom resource, defining the desired state
 * of an OpenCrane tenant deployment.
 */
export interface TenantSpec
{
  /** Human-readable name for the tenant. */
  displayName: string;

  /** Contact email for the tenant owner. */
  email: string;

  /**
   * IdP-verified subject (OIDC `sub`) this workspace is bound to. Used as the per-user memory
   * scope id for the Cognee plugin (`plugins.entries.cognee-openclaw.config.userId`). Optional —
   * absent only on legacy/imported tenants, where the memory user scope falls back to the email.
   */
  subject?: string;

  /** Optional team identifier for grouping tenants. */
  team?: string;

  /** Optional monthly budget for the tenant's LiteLLM virtual key (USD). */
  monthlyBudgetUsd?: number;

  /** Resource requests for the tenant container. */
  resources?: {
    /** CPU resource request (e.g. "500m"). */
    cpu?: string;
    /** Memory resource request (e.g. "256Mi"). */
    memory?: string;
  };

  /** Name of an AccessPolicy CR to bind to this tenant. */
  policyRef?: string;

  /**
   * Optional name of the parent ClusterTenant (the first-class customer /
   * isolation unit this openclaw belongs to). When set, the operator resolves
   * the parent's bound namespace and compute/quota policy and deploys the
   * openclaw there. When absent, the openclaw attaches to the implicit default
   * cluster tenant bound to the install namespace — single-install behaviour is
   * unchanged and multi-tenancy stays opt-in.
   */
  clusterTenantRef?: string;

  /** When true, the tenant deployment is scaled to zero. */
  suspended?: boolean;
}
