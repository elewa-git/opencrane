/**
 * Observed status of a Tenant custom resource, written by the operator
 * after each reconciliation loop.
 */
export enum TenantStatusPhase
{
  /** Tenant has been created but workloads are not fully reconciled yet. */
  Pending = "Pending",

  /** Tenant workloads are provisioned and serving traffic. */
  Running = "Running",

  /** Tenant workload is intentionally scaled down to zero replicas. */
  Suspended = "Suspended",

  /**
   * The tenant is running on a previously-applied config, but the latest reconcile
   * could not safely refresh it. Set when the `tenant-models` fetch returned empty or
   * failed and the operator DELIBERATELY skipped the ConfigMap re-render to avoid
   * clobbering a working config with a model-less one (see `_ResolveTenantModelGate`).
   * The workload keeps serving; `degradedReason` records why the refresh was skipped.
   */
  Degraded = "Degraded",

  /** Reconciliation failed and operator recorded the latest error message. */
  Error = "Error",
}

/** Why a reconcile marked the tenant {@link TenantStatusPhase.Degraded}. */
export enum TenantDegradedReason
{
  /**
   * The opencrane-ui returned a well-formed empty model set (the tenant has no
   * registered models — onboarding is incomplete). The last-applied ConfigMap was kept.
   */
  ModelSetEmpty = "ModelSetEmpty",

  /**
   * The `tenant-models` fetch failed (transport error, timeout, non-200, or malformed
   * body), so the real model set is unknown. The last-applied ConfigMap was kept.
   */
  ModelFetchFailed = "ModelFetchFailed",
}

/** Resolution state for how tenant policy assignment was computed. */
export enum TenantPolicyResolutionState
{
  /** Effective policy was resolved successfully. */
  Resolved = "Resolved",

  /** No policy applies and no default policy is configured. */
  NoPolicy = "NoPolicy",

  /** Tenant references a policy that does not exist. */
  PolicyNotFound = "PolicyNotFound",

  /** More than one selector-based policy matched the tenant. */
  PolicyConflict = "PolicyConflict",

  /** Configured default policy name was not found. */
  DefaultPolicyNotFound = "DefaultPolicyNotFound",
}

/** Source that produced the effective policy assignment. */
export type TenantPolicyResolutionSource = "policyRef" | "selector" | "default" | "none";

/**
 * Observed status of a Tenant custom resource, written by the operator
 * after each reconciliation loop.
 */
export interface TenantStatus
{
  /** Current lifecycle phase of the tenant. */
  phase: TenantStatusPhase;

  /** Name of the tenant pod managed by the deployment. */
  podName?: string;

  /**
   * The namespace this tenant's child resources (pod, Secrets, ConfigMap, Service) were
   * last deployed into. This is the RESOLVED deployment target — for a `clusterTenantRef`
   * openclaw it is the parent's bound namespace, which differs from the Tenant CR's own
   * namespace. Cleanup reads this so revoke/delete target the same namespace creation used,
   * rather than assuming the CR namespace (which would orphan a ref'd tenant's resources).
   */
  namespace?: string;

  /** Hostname assigned to the tenant ingress. */
  ingressHost?: string;

  /** Human-readable message describing the current phase. */
  message?: string;

  /** Name of the policy currently resolved as effective for this tenant. */
  effectivePolicyRef?: string;

  /** Source used to resolve the effective policy. */
  policyResolutionSource?: TenantPolicyResolutionSource;

  /** Resolution state of tenant policy assignment. */
  policyResolutionState?: TenantPolicyResolutionState;

  /**
   * Why the tenant is {@link TenantStatusPhase.Degraded}, when it is. Cleared (set to
   * `undefined`) on any reconcile that resolves back to a healthy phase so a recovered
   * tenant does not carry a stale reason.
   */
  degradedReason?: TenantDegradedReason;

  /** ISO-8601 timestamp of the last successful reconciliation. */
  lastReconciled?: string;

  /**
   * `metadata.generation` the operator last drove to `Running`. The API server bumps
   * `generation` only on a spec change (status writes do not), so a watch replay of an
   * unchanged, already-running Tenant has `observedGeneration === metadata.generation`
   * and is skipped — the controller guard that stops redundant re-reconciles (and the
   * status-write→watch-event churn they trigger) on every watch cycle.
   */
  observedGeneration?: number;

  /**
   * The operator-config checksum (`_OperatorConfigChecksum`) in effect when this tenant
   * was last driven to `Running`. `metadata.generation` only tracks the tenant's OWN
   * spec, not the operator's config/values — so without this a `helm upgrade` that
   * changes operator config (e.g. `trustedProxies`, a runtime-plane URL) would be
   * short-circuited by the generation guard on every existing tenant. The guard also
   * compares this against the operator's current checksum, so an operator-config change
   * re-arms a full reconcile without a manual restart or per-tenant spec edit. Left
   * UNSET while degraded, alongside `observedGeneration`.
   */
  observedConfigChecksum?: string;
}
