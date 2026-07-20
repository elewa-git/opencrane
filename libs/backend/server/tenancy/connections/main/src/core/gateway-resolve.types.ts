/** IdP-verified user identity carried into the gateway routing decision. */
export interface GatewayResolvedUser
{
  /** Normalized verified email used to resolve the workspace. */
  email: string;
  /** Verified IdP subject used for membership enforcement and logging. */
  sub: string;
}

/** Workspace tenant selected by the gateway routing decision. */
export interface GatewayResolvedTenant
{
  /** Stable workspace tenant name. */
  name: string;
  /** Owning organization, or null for an unscoped tenant. */
  clusterTenantRef: string | null;
}

/** In-cluster service target for the selected workspace pod. */
export interface GatewayResolvedPodService
{
  /** Kubernetes Service name for the workspace pod. */
  name: string;
  /** Kubernetes namespace containing the Service. */
  namespace: string;
}

/** Authoritative routing decision used by the identity-routing gateway proxy. */
export interface GatewayResolveResult
{
  /** Verified identity the proxy logs and rate-limits. */
  user: GatewayResolvedUser;
  /** Per-user workspace tenant selected for the connection. */
  tenant: GatewayResolvedTenant;
  /** In-cluster Service the proxy forwards the connection to. */
  podService: GatewayResolvedPodService;
}

/** Fail-closed reasons a gateway target cannot be resolved. */
export type GatewayResolveFailure = "NO_EMAIL" | "NO_TENANT" | "AMBIGUOUS_TENANT" | "MEMBER_SUSPENDED";

/** Successful gateway resolution outcome. */
export interface GatewayResolveSuccess
{
  /** Discriminator indicating that a route target was resolved. */
  ok: true;
  /** Verified identity and in-cluster target selected for the connection. */
  resolved: GatewayResolveResult;
}

/** Denied gateway resolution outcome. */
export interface GatewayResolveDenied
{
  /** Discriminator indicating that routing failed closed. */
  ok: false;
  /** Stable reason code mapped to a forbidden response at the edge. */
  code: GatewayResolveFailure;
}

/** Resolution outcome: a forward target, or a fail-closed reason. */
export type GatewayResolveOutcome = GatewayResolveSuccess | GatewayResolveDenied;
