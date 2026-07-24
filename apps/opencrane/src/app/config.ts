import { type OpenClawTenantOperatorConfig } from "@opencrane/backend/feat-openclaw-tenant";
import { HostingProvider, type GcpHostingConfig } from "@opencrane/server/_infra/tenant-hosting";
import { _ParseTrustedProxies, _DeriveTrustedProxyCidr, _AUTO_TRUSTED_PROXY_TOKEN, _DEFAULT_AUTO_TRUSTED_PROXY_MASK } from "@opencrane/server/_infra/http";
import { _log } from "./log.js";

export type { OpenClawTenantOperatorConfig } from "@opencrane/backend/feat-openclaw-tenant";
export type { GcpHostingConfig } from "@opencrane/server/_infra/tenant-hosting";
export { HostingProvider };

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

  if (trustedProxies.trustNothing) {
    throw new Error("GATEWAY_TRUSTED_PROXIES is empty or unresolvable; openclaw requires at least one trusted proxy CIDR for trusted-proxy auth to function.");
  }

  // 2c. The clean target is a self-contained control plane. An installation always owns
  //     its ClusterTenant lifecycle; no environment variable can switch it back to an
  //     external-fleet topology.
  const deploymentMode = "standalone" as const;

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
    manageTenantNamespaces: _readEnvValue<boolean>("MANAGE_TENANT_NAMESPACES", "boolean", false, true),
    manageOwnDomain: _readEnvValue<boolean>("MANAGE_OWN_DOMAIN", "boolean", false, true),
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
