import type { AccessPolicy } from "../reconcilers/policies/types.js";
import { type OpenClawTenantOperatorConfig, HostingProvider } from "../app/config.js";
import type { Tenant } from "../reconcilers/tenants/models/tenant.types.js";
import { TenantStatusPhase } from "../reconcilers/tenants/models/tenant-status.interface.js";
import type { ClusterTenantResource } from "@opencrane/infra/api";
import { OnPremHostingAdapter } from "../hosting/adapters/onprem/onprem-hosting.adapter.js";
import { GcpHostingAdapter } from "../hosting/adapters/gcp/gcp-hosting.adapter.js";
import type { GcsBucketOperations } from "../hosting/adapters/gcp/gcp-bucket.client.js";

/**
 * Shared operator config fixture — on-prem baseline (no cloud fields required).
 */
export const defaultConfig: OpenClawTenantOperatorConfig = {
  watchNamespace: "default",
  requireWatchNamespace: false,
  tenantDefaultImage: "ghcr.io/opencrane/tenant:openclaw-2026.6.11-cognee-2026.7.9",
  ingressDomain: "opencrane.local",
  ingressIp: "",
  certManagerIssuerName: "opencrane-issuer",
  certManagerIssuerKind: "ClusterIssuer",
  ingressTlsEnabled: false,
  ingressTlsSecretName: "opencrane-wildcard-tls",
  gatewayPort: 18789,
  gatewayTrustedProxies: ["10.0.0.0/8"],
  gatewayTrustNothing: false,
  gatewayTrustedProxyUserHeader: "X-Forwarded-User",
  operatorNamespace: "default",
  gatewayProxyEnabled: false,
  gatewayProxyPort: 8090,
  clusterDomain: "svc.cluster.local",
  gatewayProxyAllowedOrigins: [],
  gatewayProxyAllowedOriginBaseDomains: [],
  gatewayProxyRateLimitPerMinute: 60,
  hostingProvider: HostingProvider.OnPrem,
  tenantStorageClassName: "",
  idleTimeoutMinutes: 30,
  idleCheckIntervalSeconds: 60,
  liteLlmEnabled: false,
  liteLlmEndpoint: "http://opencrane-litellm:4000",
  liteLlmMasterKey: "",
  liteLlmDefaultMonthlyBudgetUsd: 50,
  liteLlmBudgetDuration: "30d",
  liteLlmDefaultTpmLimit: 0,
  liteLlmDefaultRpmLimit: 0,
  cogneeLiteLlmMonthlyBudgetUsd: 10,
  mcpGatewayUrl: "http://opencrane-mcp-gateway.default.svc:8080",
  skillRegistryUrl: "http://opencrane-feat-skill-registry.default.svc:5000",
  cogneeEndpoint: "",
  internalPort: 8081,
  controlPlaneInternalUrl: "http://localhost:8081",
  controlPlaneInternalServiceUrl: "http://opencrane-opencrane-server.default.svc:8081",
  projectedTokenTtlSeconds: 600,
  linkerdMeshEnabled: false,
  // Fleet-managed baseline fixture (#151 item 4): tests exercising the standalone path opt in
  // via a config override (deploymentMode: "standalone", etc).
  deploymentMode: "fleet-managed",
  standaloneSeedName: "",
  standaloneSeedDisplayName: "",
  standaloneSeedOwnerEmail: "",
  standaloneSeedOwnerSubject: "",
  standaloneSeedTier: "shared",
  // Production default: the fleet-manager owns per-org namespace creation, so the silo does not
  // attempt it. Tests exercising the standalone create path opt in via a config override.
  manageTenantNamespaces: false,
  // Fleet-managed baseline: the external fleet owns per-org domain provisioning. Tests
  // exercising the standalone domain-provisioning path opt in via a config override.
  manageOwnDomain: false,
};

/**
 * GCP-flavoured config fixture for tests that exercise cloud paths.
 */
export const gcpConfig: OpenClawTenantOperatorConfig = {
  ...defaultConfig,
  hostingProvider: HostingProvider.Gcp,
  gcp: {
    projectId: "my-gcp-project",
    bucketPrefix: "opencrane",
    csiDriver: "gcsfuse.csi.storage.gke.io",
  },
};

/** On-prem hosting adapter instance shared across tests. */
export const onPremAdapter = new OnPremHostingAdapter();

/** Fake GCS bucket client that records calls without hitting the network. */
export const fakeGcsBuckets: GcsBucketOperations & { provisioned: string[] } = {
  provisioned: [],
  async ensureBucket(bucketName: string): Promise<void>
  {
    fakeGcsBuckets.provisioned.push(bucketName);
  },
};

/** GCP hosting adapter backed by the fake bucket client. */
export const gcpAdapter = new GcpHostingAdapter(
  { projectId: "my-gcp-project", bucketPrefix: "opencrane", csiDriver: "gcsfuse.csi.storage.gke.io" },
  fakeGcsBuckets,
);

/**
 * Create a minimal Tenant fixture with the given name and optional
 * spec overrides and status properties for use in unit tests.
 */
export function _makeTenant(
  name: string,
  options?: {
    suspended?: boolean;
    phase?: TenantStatusPhase;
    namespace?: string;
  } & Partial<Tenant["spec"]>,
): Tenant
{
  const { phase, namespace, suspended, ...specOverrides } = options ?? {};

  return {
    apiVersion: "opencrane.io/v1alpha1",
    kind: "Tenant",
    metadata: { name, namespace: namespace ?? "default" },
    spec: {
      displayName: name.charAt(0).toUpperCase() + name.slice(1),
      email: `${name}@example.com`,
      suspended,
      ...specOverrides,
    },
    status: {
      phase: phase ?? TenantStatusPhase.Running,
    },
  };
}

/**
 * Create a minimal ClusterTenant fixture (operator-local view) with the given
 * name and bound namespace for use in cluster-tenant resolution tests.
 */
export function _makeClusterTenant(name: string, boundNamespace?: string): ClusterTenantResource
{
  return {
    apiVersion: "opencrane.io/v1alpha1",
    kind: "ClusterTenant",
    metadata: { name },
    spec: {
      displayName: name.charAt(0).toUpperCase() + name.slice(1),
      isolationTier: "shared",
      compute: { mode: "shared" },
      resources: { quota: { cpu: "4", memory: "8Gi", pods: 10 } },
    },
    status: boundNamespace ? { phase: "ready", boundNamespace } : undefined,
  };
}

/**
 * Create a minimal AccessPolicy fixture for use in unit tests.
 */
export function _makeAccessPolicy(): AccessPolicy
{
  return {
    apiVersion: "opencrane.io/v1alpha1",
    kind: "AccessPolicy",
    metadata: {
      name: "default-egress",
      namespace: "default",
    },
    spec: {
      description: "Default tenant egress",
      tenantSelector: {
        matchLabels: { "opencrane.io/tenant": "jente" },
        matchTeam: "engineering",
      },
      egressRules: [
        {
          cidr: "10.0.0.0/8",
          ports: [443],
          protocol: "TCP",
        },
      ],
      domains: {
        allow: ["api.openai.com", "*.anthropic.com"],
      },
      mcpServers: {
        allow: ["skills"],
      },
    },
  };
}
