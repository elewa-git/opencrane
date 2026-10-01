/**
 * How strongly one customer's workloads are separated from other customers'.
 *
 * The operator and the provisioner both read this: it decides which nodes a customer's pods may
 * land on and, for `dedicatedCluster`, whether the request can be served at all — that tier is
 * rejected unless an external provisioner is registered for it.
 * @see {@link ClusterTenantProvisionerRegistry}
 */
export enum ClusterTenantIsolationTier
{
  /** Namespace in a shared cluster, bin-packed onto shared nodes (max density). */
  Shared = "shared",
  /** Namespace plus a tainted node pool so the customer's pods land on dedicated machines. */
  DedicatedNodes = "dedicatedNodes",
  /** Own kube-apiserver (external provisioner only; rejected unless one is registered). */
  DedicatedCluster = "dedicatedCluster",
}

/** Whether a customer shares nodes with others or gets machines to itself. */
export enum ClusterTenantComputeMode
{
  /** Pods are bin-packed onto shared nodes. */
  Shared = "shared",
  /** Pods are pinned to the customer's own node pool via nodeSelector/tolerations. */
  Dedicated = "dedicated",
}

/** How far along a cluster tenant's provisioning is. Only `ready` means workloads may be scheduled; `failed` puts the reason in `message`. */
export enum ClusterTenantPhase
{
  /** Accepted but not yet acted on. */
  Pending = "pending",
  /** A provisioner is building the customer's boundary. */
  Provisioning = "provisioning",
  /** The boundary exists and governed workloads can be scheduled. */
  Ready = "ready",
  /** Provisioning failed; see `message`. */
  Failed = "failed",
}

/**
 * Where a cluster tenant's pods are allowed to run.
 *
 * Runtime launchers turn this into the `nodeSelector` and tolerations they set on every workload
 * they create. `nodePool` is required when `mode` is `dedicated` and ignored otherwise.
 */
export interface ClusterTenantCompute
{
  /** Whether the customer shares nodes or gets a dedicated pool. */
  mode: ClusterTenantComputeMode;
  /** Name of the dedicated node pool; required when `mode` is `dedicated`. */
  nodePool?: string;
}

/**
 * Aggregate resource ceiling for a cluster tenant, enforced as a Kubernetes
 * `ResourceQuota`/`LimitRange` over the customer's namespace.
 */
export interface ClusterTenantResourceQuota
{
  /** Total CPU the customer may request (e.g. `"4"`, `"500m"`). */
  cpu?: string;
  /** Total memory the customer may request (e.g. `"8Gi"`). */
  memory?: string;
  /** Maximum number of pods the customer may run. */
  pods?: number;
  /** Total persistent storage the customer may claim (e.g. `"100Gi"`). */
  storage?: string;
  /** Total GPUs the customer may request. */
  gpu?: number;
}

/** Observed state for a cluster tenant, mirrored from the CRD status subresource. */
export interface ClusterTenantStatus
{
  /** Current lifecycle phase. */
  phase: ClusterTenantPhase;
  /** Human-readable detail, set on failure or transitional states. */
  message?: string;
  /** Namespace bound to this customer once provisioned. */
  boundNamespace?: string;
  /** Identifier of the provisioner that owns this customer's boundary. */
  provisioner?: string;
}

/**
 * Raw observed status as read straight off the ClusterTenant CR's status subresource —
 * the canonical shape the operator stamps and the control plane reads back.
 *
 * Distinct from {@link ClusterTenantStatus}: `phase` is the raw CR string (not yet mapped
 * to the {@link ClusterTenantPhase} enum) and every field is optional, because a CR may be
 * observed mid-reconcile with only a partial status. The opencrane-ui read path maps this
 * into {@link ClusterTenantStatus} for the API response. Defined once here so the operator
 * writer and the opencrane-ui reader cannot drift apart.
 */
export interface ClusterTenantObservedStatus
{
  /** Current lifecycle phase the operator observed (pending|provisioning|ready|failed). */
  phase?: string;
  /** Human-readable detail, set on failure or transitional states. */
  message?: string;
  /** Namespace the operator bound to this customer once provisioned. */
  boundNamespace?: string;
  /** Identifier of the provisioner that owns this customer's boundary. */
  provisioner?: string;
}

/**
 * One customer: the unit OpenCrane isolates, quotas, and provisions against.
 *
 * The control plane emits this shape; workload launchers read its placement and namespace to
 * decide where a customer's pods may run. `status` is absent until the operator has reconciled
 * the tenant at least once, so a reader must handle its absence rather than assuming `pending`.
 */
export interface ClusterTenant
{
  /** Stable cluster-scoped identifier (the customer key). */
  name: string;
  /** Human-readable customer name. */
  displayName: string;
  /**
   * Optional customer-vanity domain CNAMEd onto this org's canonical apex
   * `<name>.<platformBaseDomain>` (e.g. `ai.client-company.com`). This is an OVERLAY,
   * not the org's identity: the org is always served at its derived `<name>.<base>`
   * apex (and users at `<user>.<name>.<base>`); a vanity domain is an additional name
   * the customer points at that apex. When unset, only the platform-derived apex
   * serves the org. See docs/agents/cluster-architecture.md → "Tenancy Model".
   */
  vanityDomain?: string;
  /** Isolation strength chosen for this customer. */
  isolationTier: ClusterTenantIsolationTier;
  /** Compute placement policy. */
  compute: ClusterTenantCompute;
  /** Resource gating for the customer's namespace. */
  resources: ClusterTenantResources;
  /**
   * Maximum org memberships (seats). Absent = uncapped. The fleet refuses a new member
   * once the org is at its cap (409 SEAT_CAP_EXCEEDED); role changes never consume a seat.
   */
  seatCap?: number | null;
  /**
   * Public per-org Zitadel OIDC identifiers, projected onto the CR spec so the silo can
   * resolve per-org login from the CR. Absent until the org is provisioned in Zitadel.
   */
  zitadel?: ClusterTenantZitadel;
  /** Observed state; absent until first reconciled. */
  status?: ClusterTenantStatus;
}

/** Resource-gating block of a cluster tenant spec. */
export interface ClusterTenantResources
{
  /** Aggregate quota enforced across the customer's namespace. */
  quota: ClusterTenantResourceQuota;
}

/**
 * Public per-org Zitadel OIDC identifiers, projected onto the ClusterTenant CR spec so the
 * silo can resolve a host's per-org login client straight from the CR (the single source of
 * truth) without its own ClusterTenant read-model. These are PUBLIC OIDC ids — a client_id, an
 * org id and a redirect URI — NOT secrets, so carrying them on a cluster-scoped CR is safe.
 * The fleet sets them in its registry DB after `provisionOrg`, then projects them here.
 */
export interface ClusterTenantZitadel
{
  /** The org's OIDC `client_id` login authorizes with (the per-org public credential). */
  clientId?: string;
  /** The org's Zitadel Organization id — added as the `urn:zitadel:iam:org:id:{orgId}` login scope. */
  orgId?: string;
  /** The redirect URI registered on the org's OIDC app, when known. */
  redirectUri?: string;
}

/**
 * Generic provision request POSTed to an external provisioner webhook. Carries
 * no vendor-specific fields so any backend (e.g. a hosted-opencrane-ui vendor)
 * can satisfy a `dedicatedCluster` request out-of-process, at arm's length.
 */
export interface ClusterTenantProvisionRequest
{
  /** Customer key being provisioned. */
  name: string;
  /** Isolation strength requested. */
  isolationTier: ClusterTenantIsolationTier;
  /** Compute placement policy requested. */
  compute: ClusterTenantCompute;
  /** Aggregate quota requested. */
  quota: ClusterTenantResourceQuota;
}

/**
 * Generic provision result returned by a provisioner. The kubeconfig is handed
 * back only as a Secret *reference*, never as inline credential material.
 */
export interface ClusterTenantProvisionResult
{
  /** Resulting lifecycle phase. */
  phase: ClusterTenantPhase;
  /** Human-readable detail, set on failure or transitional states. */
  message?: string;
  /** Namespace bound to the customer, when the provisioner owns namespace creation. */
  boundNamespace?: string;
  /** Name of a Kubernetes Secret holding the customer's kubeconfig, for `dedicatedCluster`. */
  kubeconfigSecretRef?: string;
}

/**
 * Capability advertisement for a registered provisioner. The control plane uses
 * `supportedTiers` to route a cluster tenant to a backend and to reject tiers no
 * backend can serve.
 */
export interface ClusterTenantProvisionerCapability
{
  /** Stable provisioner identifier (e.g. `shared`, or a vendor's name). */
  id: string;
  /** Isolation tiers this provisioner can satisfy. */
  supportedTiers: ClusterTenantIsolationTier[];
}

/**
 * Registry signature shared by the management API and the provisioner seam so
 * the two can be built independently. The concrete registry (with the built-in
 * shared provisioner and any external webhook backends) is implemented in the
 * control plane; callers only need to ask whether a tier can be served.
 */
export interface ClusterTenantProvisionerRegistry
{
  /** Whether some registered provisioner can serve the given isolation tier. */
  isTierAvailable(tier: ClusterTenantIsolationTier): boolean;
  /** Capabilities of every registered provisioner. */
  capabilities(): ClusterTenantProvisionerCapability[];
}

/**
 * Coded error returned by the management API when a cluster tenant requests an
 * isolation tier that no registered provisioner can serve (e.g. `dedicatedCluster`
 * with no external backend configured).
 */
export const ClusterTenantTierUnavailableCode = "TIER_UNAVAILABLE";
