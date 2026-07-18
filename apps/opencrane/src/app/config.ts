import { createHash } from "node:crypto";

import { HostingProvider, type GcpHostingConfig } from "../hosting/hosting-adapter.types.js";
import { _ParseTrustedProxies, _DeriveTrustedProxyCidr, _AUTO_TRUSTED_PROXY_TOKEN, _DEFAULT_AUTO_TRUSTED_PROXY_MASK } from "./trusted-proxies.js";
import { _log } from "./log.js";

export type { GcpHostingConfig };
export type { OpenClawTenantOperatorConfig } from "./config.types.js";
export { HostingProvider };

/**
 * Runtime configuration for the operator, loaded from environment variables.
 */
interface OpenClawTenantOperatorConfig
{
  /** Namespace to watch for CRDs (empty string watches all namespaces). */
  watchNamespace: string;

  /**
   * Multi-instance fail-closed guard: when true the operator refuses to start
   * with an empty `watchNamespace`, so an instance can never reconcile another
   * instance's Tenants cluster-wide (multi-instance brief B2).
   */
  requireWatchNamespace: boolean;

  /** Default container image used for tenant deployments. */
  tenantDefaultImage: string;

  /** Base domain for tenant ingress hostnames. */
  ingressDomain: string;

  /**
   * Cluster ingress external IP the per-org wildcard A records (declared as a DNSEndpoint
   * CR) point at. Empty when unknown (e.g. on-prem or before the LoadBalancer IP is
   * assigned); the per-org DNS side effect is then skipped and only the Certificate is
   * applied.
   */
  ingressIp: string;

  /** cert-manager issuer name the per-org Certificate references. */
  certManagerIssuerName: string;

  /** Issuer kind for the per-org Certificate: `ClusterIssuer` (default) or `Issuer`. */
  certManagerIssuerKind: "ClusterIssuer" | "Issuer";

  /** When true, the tenant Ingress gets a `tls:` block referencing the wildcard cert. */
  ingressTlsEnabled: boolean;

  /** Name of the (wildcard) TLS Secret the tenant Ingress serves; must exist in the tenant namespace. */
  ingressTlsSecretName: string;

  /** Port number exposed by the OpenClaw gateway inside tenant pods. */
  gatewayPort: number;

  /**
   * Reverse-proxy CIDRs/IPs the OpenClaw gateway trusts for `trusted-proxy` auth
   * (OC-2 / CONN.4). The gateway authenticates a connection as the user named in
   * {@link gatewayTrustedProxyUserHeader} only when the TCP source is one of these.
   * Set to the ingress source range; a NetworkPolicy additionally restricts the
   * gateway port to the ingress so this range can't be abused by other pods.
   *
   * Validated and fail-closed at load (see {@link _ParseTrustedProxies}): an empty
   * allowlist means **trust nothing** (never trust-all) and is paired with
   * {@link gatewayTrustNothing}; a malformed entry crashes the operator at startup.
   */
  gatewayTrustedProxies: string[];

  /**
   * Fail-closed trust flag derived from {@link gatewayTrustedProxies}: `true` when
   * no proxy source was configured, so the gateway is rendered to trust no source
   * and the trusted-proxy header is ignored. Disambiguates the empty allowlist so
   * an unconfigured operator can never silently trust every connection.
   */
  gatewayTrustNothing: boolean;

  /** Header the trusted proxy injects with the authenticated user identity. */
  gatewayTrustedProxyUserHeader: string;

  // -- Identity-routing gateway proxy, folded in-process into the operator (DOMAIN.T4) --

  /** The operator's own namespace — the per-pod gateway NetworkPolicy admits the gateway
   *  port from the operator (which now hosts the in-process proxy) in this namespace. */
  operatorNamespace: string;
  /** Whether the operator runs the in-process gateway proxy server. */
  gatewayProxyEnabled: boolean;
  /** TCP port the in-operator proxy listens on (distinct from the gateway port). */
  gatewayProxyPort: number;
  /** In-cluster DNS suffix for the pod Service FQDN the proxy forwards to. */
  clusterDomain: string;
  /** Exact `Origin` values allowed on a gateway WS upgrade (CSWSH), for vanity hosts. */
  gatewayProxyAllowedOrigins: string[];
  /** Platform base domains; any `https://<org>.<base>` host is allowed (CSWSH). */
  gatewayProxyAllowedOriginBaseDomains: string[];
  /** Max gateway sockets one identity may open per minute (per operator replica). */
  gatewayProxyRateLimitPerMinute: number;

  /** Active hosting substrate. Defaults to on-prem. */
  hostingProvider: HostingProvider;

  /** GCP-specific config; present only when hostingProvider === Gcp. */
  gcp?: GcpHostingConfig;

  /**
   * StorageClass stamped on the per-tenant state PVC (on-prem/non-cloud path). Empty ⇒
   * the PVC omits `storageClassName` and binds to the cluster default StorageClass
   * (byte-for-byte unchanged from before this knob existed). Set it to pin the PVC to an
   * encrypted/CMEK class for multi-CT installs.
   */
  tenantStorageClassName: string;

  /** Minutes of inactivity before a tenant is auto-suspended (0 = disabled). */
  idleTimeoutMinutes: number;

  /** How often (in seconds) the idle-check loop runs. */
  idleCheckIntervalSeconds: number;

  /** When true, tenant reconcile provisions per-tenant LiteLLM virtual keys. */
  liteLlmEnabled: boolean;

  /** Cluster-local LiteLLM base endpoint (e.g. http://litellm:4000). */
  liteLlmEndpoint: string;

  /** Master key used by the operator to call LiteLLM key-management APIs. */
  liteLlmMasterKey: string;

  /** Default monthly budget (USD) applied when tenant does not override it. */
  liteLlmDefaultMonthlyBudgetUsd: number;

  /**
   * Budget reset window passed to LiteLLM (`budget_duration`) so the per-tenant
   * spend cap rolls over on a fixed cadence (e.g. "30d"). Without it the
   * `max_budget` is a lifetime cap that never resets.
   */
  liteLlmBudgetDuration: string;

  /**
   * Default per-key tokens-per-minute throttle applied at key generation.
   * The Tenant CR has no per-tenant rate-limit field, so this config default is
   * the only lever; 0 (or negative) leaves the limit unset on LiteLLM.
   */
  liteLlmDefaultTpmLimit: number;

  /**
   * Default per-key requests-per-minute throttle applied at key generation.
   * Mirrors `liteLlmDefaultTpmLimit`; 0 (or negative) leaves it unset.
   */
  liteLlmDefaultRpmLimit: number;

  /**
   * Monthly budget (USD) for this silo's dedicated Cognee LiteLLM key (embedding +
   * graph-extraction LLM calls). Deliberately a SEPARATE key/budget from tenant chat
   * spend — Cognee's spend must be trackable as its own identity, not folded into a
   * tenant's cap. No `team_id` is ever attached (LiteLLM's Team object is not
   * provisioned anywhere in this codebase yet; see tenant-litellm-keys.ts).
   */
  cogneeLiteLlmMonthlyBudgetUsd: number;

  /** Optional default AccessPolicy name used when no explicit or selector match is found. */
  defaultTenantPolicyRef?: string;

  /** In-cluster MCP gateway URL exposed to tenant runtimes through managed env/contract. */
  mcpGatewayUrl: string;

  /** In-cluster skill registry delivery URL exposed to tenant runtimes. */
  skillRegistryUrl: string;

  /**
   * In-cluster per-tenant Cognee base URL (e.g. `http://cognee:8000`), injected into tenant
   * pods as `COGNEE_ENDPOINT` so the Cognee OpenClaw memory plugin can retrieve org context
   * directly (no opencrane-ui mediation in the hot path). Empty string ⇒ Cognee is not wired
   * into the pod and the runtime falls back
   * to workspace-file memory only; this mirrors the opencrane-ui's "skip when unset" grant-sync
   * behaviour so a Cognee-less deployment stays byte-for-byte unchanged.
   */
  cogneeEndpoint: string;

  /**
   * The operator's OWN in-pod internal API base — the second (internal) listener. Used by the
   * operator's reconcile fetches (tenant-models). Defaults to `http://localhost:<internalPort>`;
   * the internal routes are NOT on the public listener, so this must target the internal port.
   */
  controlPlaneInternalUrl: string;

  /**
   * In-cluster SERVICE URL of the internal listener (`http://<svc>.<ns>.svc:<internalPort>`),
   * injected into TENANT pods (and used by other planes) to reach `/api/internal/*` from another
   * pod. Distinct from {@link controlPlaneInternalUrl} (localhost, operator-self) — a tenant pod's
   * localhost is itself, so pods MUST use the Service DNS.
   */
  controlPlaneInternalServiceUrl: string;

  /**
   * Port of the SECOND HTTP listener that serves ONLY the tokenless `/api/internal/*` routes.
   * Split from the public port so the internal API is never on the ingress-facing listener
   * (the public ingress routes `/api` to the public port only). NetworkPolicy locks this port
   * to platform pods. Default 8081.
   */
  internalPort: number;

  /** Projected ServiceAccount token TTL in seconds for ingress-plane audiences. */
  projectedTokenTtlSeconds: number;

  /**
   * Linkerd identity substrate gate (S5 / ADR 0001), default OFF. When true the silo
   * reconcile additionally annotates the silo namespace for Linkerd mesh injection and
   * emits a per-silo deny-by-default `Server` + `MeshTLSAuthentication` +
   * `AuthorizationPolicy` (the meshed mTLS-identity analogue of the S2 baseline
   * NetworkPolicy). Fail-closed default: a cluster without Linkerd installed is wholly
   * unaffected because the objects are applied ONLY when the operator is told the mesh
   * exists, and the apply itself fails closed (skips) if the Linkerd CRDs are absent.
   */
  linkerdMeshEnabled: boolean;

  /**
   * Whether this silo OWNS per-ClusterTenant namespace creation. Default derives from
   * {@link deploymentMode} (standalone ⇒ true, fleet-managed ⇒ false): in the fleet-managed
   * topology the fleet-manager creates + owns each org's namespace
   * (`managed-by: opencrane-fleet-manager`) and the silo's ServiceAccount is granted NO
   * cluster-scoped `namespaces` verbs — so the silo must NOT attempt the create (it would only
   * ever be Forbidden). When true — an all-in-one / standalone deploy that grants the silo the
   * gated namespace-management ClusterRole — the silo creates the namespace itself. Either way
   * the namespaced applies that follow (baseline NetworkPolicy, quota) require the namespace to
   * exist, so a genuinely-absent namespace still surfaces as NotFound there. Set explicitly via
   * `MANAGE_TENANT_NAMESPACES` to override the derived default.
   */
  manageTenantNamespaces: boolean;

  /**
   * Single explicit topology switch (#151 item 4): `"standalone"` — no fleet anywhere,
   * this silo owns ClusterTenant lifecycle/namespace/domain/membership itself — or
   * `"fleet-managed"` — an external (or colocated) fleet-manager owns ClusterTenant
   * lifecycle and this silo defers to it. This is the SINGLE source of truth every other
   * standalone-vs-fleet-managed default in this config derives from (manageOwnDomain,
   * manageTenantNamespaces, the `_SeedOwnDefaultTenant` / `_SeedOwnClusterTenant` boot
   * calls in index.ts).
   *
   * Set explicitly via `DEPLOYMENT_MODE`; when unset, derives from the SAME signal the
   * standalone defaults already used before this switch existed — an empty
   * `FLEET_INTERNAL_URL` (no external fleet configured) — so a deployment that never sets
   * either env var behaves EXACTLY as it did before this switch was introduced.
   */
  deploymentMode: "standalone" | "fleet-managed";

  /**
   * Standalone ClusterTenant self-seed (#151 item 4): when set (`CLUSTER_TENANT_SEED_NAME`)
   * AND `deploymentMode === "standalone"`, the operator creates ITS OWN cluster-scoped
   * ClusterTenant CR on boot (with this `owner`) and immediately binds it
   * (`status.boundNamespace = watchNamespace`) — the one action a standalone silo has no
   * external fleet to perform. No-op (empty string) leaves standalone bootstrap to a
   * manually-applied CR (see docs/agents/apps/opencrane.md's standalone
   * quickstart). Ignored entirely in fleet-managed mode: the fleet is the sole authority
   * that may create/bind a ClusterTenant CR there.
   */
  standaloneSeedName: string;

  /** Human-readable display name for {@link standaloneSeedName}; defaults to the name itself when empty. */
  standaloneSeedDisplayName: string;

  /** Owner email recorded on the self-seeded ClusterTenant's `spec.owner.email`. */
  standaloneSeedOwnerEmail: string;

  /** Optional owner OIDC subject recorded on the self-seeded ClusterTenant's `spec.owner.subject`. */
  standaloneSeedOwnerSubject: string;

  /** Isolation tier recorded on the self-seeded ClusterTenant's `spec.isolationTier`. */
  standaloneSeedTier: string;

  /**
   * Whether THIS silo owns per-org domain provisioning (#151 item 2): applying the
   * per-org DNSEndpoint + any vanity Certificate via the {@link OrgDomainProvisioner}.
   * Default derives from {@link deploymentMode} (standalone ⇒ true, no external fleet to
   * own the domain) — set explicitly via `MANAGE_OWN_DOMAIN` to override. In fleet-managed
   * mode this defaults false and the reconcile step is a no-op: the external fleet owns
   * domain provisioning for the org.
   */
  manageOwnDomain: boolean;
}

/**
 * Load operator configuration from environment variables.
 */
export function _LoadOperatorConfig(): OpenClawTenantOperatorConfig
{
  // 1. Resolve hosting provider first; GCP block is conditionally required.
  const hostingProvider = _readHostingProvider();

  // 2. Resolve this operator's own namespace for the runtime-plane URL fallbacks.
  //    The Helm chart always sets MCP_GATEWAY_URL / SKILL_REGISTRY_URL /
  //    CLUSTERTENANT_MANAGER_INTERNAL_URL to release-prefixed values, so these defaults are a
  //    safety net only. They derive from POD_NAMESPACE (downward API) so an unset env
  //    resolves to THIS instance's namespace — never a hard-coded shared namespace
  //    like `opencrane-system`, which would be a latent cross-instance footgun (B5).
  const ownNamespace = _readOwnNamespace();

  // 2b. Parse the trusted-proxy allowlist fail-closed (OC-2 / CONN.4). An empty
  //     value resolves to trust-nothing (never trust-all); a malformed CIDR throws
  //     here so a typo crashes the operator at startup rather than silently
  //     widening or narrowing the gateway's trust boundary. The opt-in `auto`
  //     token is first expanded to a pod-IP-derived CIDR (task_845dd617) — empty
  //     stays trust-nothing, so the fail-closed default (CONN.9) is preserved.
  const trustedProxies = _ParseTrustedProxies(_resolveTrustedProxiesInput(
    _readEnvValue<string>("GATEWAY_TRUSTED_PROXIES", "string", false, ""),
  ));

  // 2c. Single deployment-mode switch (#151 item 4). DEPLOYMENT_MODE wins when it is one of
  //     the two valid values; otherwise derive from the SAME signal every standalone default
  //     already used before this switch existed — an empty FLEET_INTERNAL_URL (no external
  //     fleet configured) — so a deployment that sets neither env var is unaffected by this
  //     switch's introduction. Every other standalone-vs-fleet-managed default below
  //     (manageOwnDomain, manageTenantNamespaces, the standalone boot-seed gate in index.ts)
  //     derives from THIS one value, not from FLEET_INTERNAL_URL directly, so an explicit
  //     DEPLOYMENT_MODE override cascades coherently everywhere.
  const deploymentModeRaw = _readEnvValue<string>("DEPLOYMENT_MODE", "string", false, "");
  const deploymentMode: "standalone" | "fleet-managed" = deploymentModeRaw === "standalone" || deploymentModeRaw === "fleet-managed"
    ? deploymentModeRaw
    : (process.env["FLEET_INTERNAL_URL"]?.trim() ? "fleet-managed" : "standalone");
  const isStandalone = deploymentMode === "standalone";

  // 3. Build the typed config from env, applying namespace-derived fallbacks for the
  //    runtime-plane URLs so no value silently points at another instance.
  const config: OpenClawTenantOperatorConfig = {
    watchNamespace: _readEnvValue<string>("WATCH_NAMESPACE", "string"),
    requireWatchNamespace: _readEnvValue<boolean>("REQUIRE_WATCH_NAMESPACE", "boolean", false, false),
    tenantDefaultImage: _readEnvValue<string>("TENANT_DEFAULT_IMAGE", "string"),
    ingressDomain: _readEnvValue<string>("INGRESS_DOMAIN", "string"),
    ingressIp: _readEnvValue<string>("INGRESS_IP", "string", false, ""),
    certManagerIssuerName: _readEnvValue<string>("CERT_MANAGER_ISSUER_NAME", "string", false, "opencrane-issuer"),
    certManagerIssuerKind: _readEnvValue<string>("CERT_MANAGER_ISSUER_KIND", "string", false, "ClusterIssuer") === "Issuer" ? "Issuer" : "ClusterIssuer",
    ingressTlsEnabled: _readEnvValue<boolean>("INGRESS_TLS_ENABLED", "boolean", false, false),
    ingressTlsSecretName: _readEnvValue<string>("INGRESS_TLS_SECRET_NAME", "string", false, "opencrane-wildcard-tls"),
    gatewayPort: _readEnvValue<number>("GATEWAY_PORT", "number"),
    gatewayTrustedProxies: trustedProxies.cidrs,
    gatewayTrustNothing: trustedProxies.trustNothing,
    gatewayTrustedProxyUserHeader: _readEnvValue<string>("GATEWAY_TRUSTED_PROXY_USER_HEADER", "string", false, "X-Forwarded-User"),
    operatorNamespace: ownNamespace,
    gatewayProxyEnabled: _readEnvValue<boolean>("GATEWAY_PROXY_ENABLED", "boolean", false, false),
    gatewayProxyPort: _readEnvValue<number>("GATEWAY_PROXY_PORT", "number", false, 8090),
    clusterDomain: _readEnvValue<string>("CLUSTER_DOMAIN", "string", false, "svc.cluster.local"),
    gatewayProxyAllowedOrigins: _splitCsv(_readEnvValue<string>("GATEWAY_PROXY_ALLOWED_ORIGINS", "string", false, "")),
    gatewayProxyAllowedOriginBaseDomains: _splitCsv(_readEnvValue<string>("GATEWAY_PROXY_ALLOWED_ORIGIN_BASE_DOMAINS", "string", false, "")),
    gatewayProxyRateLimitPerMinute: _readEnvValue<number>("GATEWAY_PROXY_RATE_LIMIT_PER_MINUTE", "number", false, 60),
    hostingProvider,
    gcp: hostingProvider === HostingProvider.Gcp
      ? {
          projectId: _readEnvValue<string>("GCP_PROJECT_ID", "string"),
          bucketPrefix: _readEnvValue<string>("GCP_BUCKET_PREFIX", "string"),
          csiDriver: _readEnvValue<string>("GCP_CSI_DRIVER", "string", false, "gcsfuse.csi.storage.gke.io"),
        }
      : undefined,
    tenantStorageClassName: _readEnvValue<string>("TENANT_STORAGE_CLASS", "string", false, ""),
    idleTimeoutMinutes: _readEnvValue<number>("IDLE_TIMEOUT_MINUTES", "number"),
    idleCheckIntervalSeconds: _readEnvValue<number>("IDLE_CHECK_INTERVAL_SECONDS", "number"),
    liteLlmEnabled: _readEnvValue<boolean>("LITELLM_ENABLED", "boolean"),
    liteLlmEndpoint: _readEnvValue<string>("LITELLM_ENDPOINT", "string"),
    liteLlmMasterKey: _readEnvValue<string>("LITELLM_MASTER_KEY", "string", false, ""),
    liteLlmDefaultMonthlyBudgetUsd: _readEnvValue<number>("LITELLM_DEFAULT_MONTHLY_BUDGET_USD", "number"),
    liteLlmBudgetDuration: _readEnvValue<string>("LITELLM_BUDGET_DURATION", "string", false, "30d"),
    liteLlmDefaultTpmLimit: _readEnvValue<number>("LITELLM_DEFAULT_TPM_LIMIT", "number", false, 0),
    liteLlmDefaultRpmLimit: _readEnvValue<number>("LITELLM_DEFAULT_RPM_LIMIT", "number", false, 0),
    cogneeLiteLlmMonthlyBudgetUsd: _readEnvValue<number>("COGNEE_LITELLM_MONTHLY_BUDGET_USD", "number", false, 10),
    defaultTenantPolicyRef: _readEnvValue<string>("DEFAULT_TENANT_POLICY_REF", "string", false, ""),
    mcpGatewayUrl: _readEnvValue<string>("MCP_GATEWAY_URL", "string", false, `http://opencrane-mcp-gateway.${ownNamespace}.svc:8080`),
    skillRegistryUrl: _readEnvValue<string>("SKILL_REGISTRY_URL", "string", false, `http://opencrane-feat-skill-registry.${ownNamespace}.svc:5000`),
    cogneeEndpoint: _readEnvValue<string>("COGNEE_ENDPOINT", "string", false, ""),
    internalPort: _readEnvValue<number>("INTERNAL_PORT", "number", false, 8081),
    controlPlaneInternalUrl: _readEnvValue<string>("CLUSTERTENANT_MANAGER_INTERNAL_URL", "string", false, "http://localhost:8081"),
    controlPlaneInternalServiceUrl: _readEnvValue<string>("CLUSTERTENANT_MANAGER_INTERNAL_SERVICE_URL", "string", false, `http://opencrane-opencrane-server.${ownNamespace}.svc:8081`),
    projectedTokenTtlSeconds: _readEnvValue<number>("PROJECTED_TOKEN_TTL_SECONDS", "number", false, 600),
    linkerdMeshEnabled: _readEnvValue<boolean>("LINKERD_MESH_ENABLED", "boolean", false, false),
    deploymentMode,
    standaloneSeedName: _readEnvValue<string>("CLUSTER_TENANT_SEED_NAME", "string", false, ""),
    standaloneSeedDisplayName: _readEnvValue<string>("CLUSTER_TENANT_SEED_DISPLAY_NAME", "string", false, ""),
    standaloneSeedOwnerEmail: _readEnvValue<string>("CLUSTER_TENANT_SEED_OWNER_EMAIL", "string", false, ""),
    standaloneSeedOwnerSubject: _readEnvValue<string>("CLUSTER_TENANT_SEED_OWNER_SUBJECT", "string", false, ""),
    standaloneSeedTier: _readEnvValue<string>("CLUSTER_TENANT_SEED_TIER", "string", false, "shared"),
    // Both derive from `deploymentMode` (not FLEET_INTERNAL_URL directly) so an explicit
    // DEPLOYMENT_MODE override cascades to them coherently; MANAGE_TENANT_NAMESPACES /
    // MANAGE_OWN_DOMAIN still let an operator force one independently of the mode.
    manageTenantNamespaces: _readEnvValue<boolean>("MANAGE_TENANT_NAMESPACES", "boolean", false, isStandalone),
    manageOwnDomain: _readEnvValue<boolean>("MANAGE_OWN_DOMAIN", "boolean", false, isStandalone),
  };

  // 4. Fail closed in multi-instance mode: refuse to watch the whole cluster when
  //    this instance must be scoped to its own namespace(s) (brief B2). Without
  //    this, an unscoped operator would reconcile every instance's Tenants.
  if (config.requireWatchNamespace && config.watchNamespace.trim().length === 0)
  {
    const message = "REQUIRE_WATCH_NAMESPACE is set but WATCH_NAMESPACE is empty; refusing to watch all namespaces in multi-instance mode";
    _log.error({ configField: "WATCH_NAMESPACE" }, message);
    throw new Error(message);
  }

  return config;
}

/**
 * Deterministic SHA-256 over the operator's OWN reconcile-affecting config, the
 * operator-input analogue of {@link _ConfigChecksum} (which rolls a TENANT pod when
 * its ConfigMap changes).
 *
 * WHY: the operator renders this config into every tenant's child resources (config
 * env, network policy, trusted-proxy list, runtime-plane URLs, …), but the reconcile
 * guard skips an already-`Running` tenant whose `observedGeneration` matches — a
 * status-only field that a config/values change does NOT bump. So a `helm upgrade`
 * that changes operator values (e.g. `trustedProxies`, a runtime-plane URL) never
 * reaches existing tenants until each Tenant spec is touched by hand.
 *
 * Folding this digest into the guard makes an operator-config change re-arm a full
 * reconcile for every tenant automatically: the checksum stamped on the last
 * `Running` status no longer matches, so the guard stops short-circuiting. Composes
 * with the generation guard (skip requires BOTH to match) — it only ever makes the
 * guard skip LESS, so it never suppresses a needed reconcile.
 *
 * @param config - The loaded operator config to digest.
 * @returns Hex SHA-256 of the canonical (sorted-key) config JSON.
 */
export function _OperatorConfigChecksum(config: OpenClawTenantOperatorConfig): string
{
  const canonical = JSON.stringify(config, Object.keys(config).sort());
  return createHash("sha256").update(canonical).digest("hex");
}

/**
 * Resolve the namespace this operator pod runs in, used only as the fallback host
 * for the runtime-plane URLs (MCP gateway, skill registry, control plane).
 *
 * Reads POD_NAMESPACE, which the Helm operator Deployment populates from the
 * downward API (`metadata.namespace`). Falls back to `default` when unset (e.g. in
 * unit tests) so the fallback never points at a hard-coded shared namespace such as
 * `opencrane-system`, which would be a latent cross-instance footgun (B5).
 *
 * @returns The operator's own namespace, or `default` when POD_NAMESPACE is unset.
 */
/** Split a comma-separated env value into trimmed, non-empty entries. */
function _splitCsv(raw: string): string[]
{
  return raw.split(",").map(s => s.trim()).filter(s => s.length > 0);
}

function _readOwnNamespace(): string
{
  const raw = process.env["POD_NAMESPACE"]?.trim();
  return raw && raw.length > 0 ? raw : "default";
}

/**
 * Expand the opt-in `auto` token in `GATEWAY_TRUSTED_PROXIES` into a CIDR derived
 * from the operator's own pod IP (task_845dd617), leaving every other entry
 * untouched for {@link _ParseTrustedProxies} to validate.
 *
 * `auto` is convenience, not the default: it widens the gateway's trust boundary to
 * the whole pod range, so it activates only when explicitly listed and is logged
 * loudly. POD_IP comes from the downward API (`status.podIP`); the mask defaults to
 * the GKE pod-range /14 and is overridable via `GATEWAY_TRUSTED_PROXIES_AUTO_MASK`.
 * If derivation fails (no/invalid POD_IP, bad mask) the token is dropped — so an
 * `auto`-only config falls back to trust-nothing rather than trust-all (CONN.9).
 *
 * @param raw - The raw comma-separated `GATEWAY_TRUSTED_PROXIES` value.
 * @returns The entry list with `auto` replaced by the derived CIDR (or removed).
 */
function _resolveTrustedProxiesInput(raw: string): string[]
{
  const entries = _splitCsv(raw);
  if (!entries.some(entry => entry.toLowerCase() === _AUTO_TRUSTED_PROXY_TOKEN))
  {
    return entries;
  }

  const podIp = process.env["POD_IP"]?.trim() ?? "";
  const maskRaw = process.env["GATEWAY_TRUSTED_PROXIES_AUTO_MASK"]?.trim();
  // Reject leading-zero / non-canonical masks (matching trusted-proxies' _isValidPrefix) so a
  // typo falls back to the safe default rather than being silently coerced.
  const maskBits = maskRaw && /^(0|[1-9]\d{0,2})$/.test(maskRaw) ? Number(maskRaw) : _DEFAULT_AUTO_TRUSTED_PROXY_MASK;
  const derived = _DeriveTrustedProxyCidr(podIp, maskBits);

  return entries.flatMap(function _expandAuto(entry)
  {
    if (entry.toLowerCase() !== _AUTO_TRUSTED_PROXY_TOKEN)
    {
      return [entry];
    }
    if (derived === null)
    {
      // Degraded-but-handled: the operator asked for `auto` but POD_IP is unusable, so the
      // token is dropped and the gateway stays fail-closed. A warning (not an error — the
      // process continues correctly), but one an operator must see to fix the missing POD_IP.
      _log.warn({ podIp }, "GATEWAY_TRUSTED_PROXIES auto mode could not derive a trusted-proxy CIDR; dropping the token");
      return [];
    }
    // Routine on every auto-mode boot, but it widens the trust boundary to the whole pod
    // range, so it is logged at warn (not error) — error-level would pollute the error log
    // on normal startup while still deserving operator visibility.
    _log.warn({ podIp, maskBits, derivedCidr: derived }, "GATEWAY_TRUSTED_PROXIES auto mode trusts the derived pod range");
    return [derived];
  });
}

/**
 * Parse the HOSTING_PROVIDER env var.
 * Defaults to on-prem when unset so plain cluster installs need no configuration.
 */
function _readHostingProvider(): HostingProvider
{
  const raw = process.env["HOSTING_PROVIDER"] ?? "";
  switch (raw)
  {
    case "gcp": return HostingProvider.Gcp;
    case "azure": return HostingProvider.Azure;
    case "aws": return HostingProvider.Aws;
    case "onprem":
    case "":
    default:
      return HostingProvider.OnPrem;
  }
}

/**
 * Supported runtime env parsing modes.
 */
type EnvValueType = "string" | "number" | "boolean";

/**
 * Read and parse a typed environment variable.
 *
 * @param envName - Environment variable name to read.
 * @param valueType - Runtime parsing mode used to convert the raw string into type T.
 * @param isMandatory - When true, throws if variable is not set.
 * @param defaultVal - Fallback value used only when variable is not set and not mandatory.
 * @returns Parsed value of type T.
 */
function _readEnvValue<T>(
  envName: string,
  valueType: EnvValueType,
  isMandatory: boolean = true,
  defaultVal: T | null = null,
): T
{
  const rawValue = process.env[envName];

  if (rawValue === undefined)
  {
    if (!isMandatory && defaultVal !== null)
    {
      return defaultVal;
    }

    const message = `${envName} is required`;
    _log.error({ configField: envName }, message);
    throw new Error(message);
  }

  try
  {
    switch (valueType)
    {
      case "string":
        return rawValue as T;
      case "number": {
        const value = Number(rawValue);
        if (!Number.isFinite(value))
        {
          throw new Error("must be a valid number");
        }

        return value as T;
      }
      case "boolean":
        if (rawValue === "true") return true as T;
        if (rawValue === "false") return false as T;
        throw new Error("must be 'true' or 'false'");
    }
  }
  catch (err)
  {
    const message = err instanceof Error ? err.message : "invalid value";
    _log.error({ err, configField: envName }, "invalid environment configuration");
    throw new Error(`${envName} ${message}`);
  }
}
