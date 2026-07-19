import type { HostingProvider, GcpHostingConfig } from "@opencrane/server/_infra/tenant-hosting";

/** Frozen-blue configuration consumed by the OpenClaw tenant reconcilers. */
export interface OpenClawTenantOperatorConfig
{
  /** Namespace watched for tenant and policy resources. */
  watchNamespace: string;
  /** Whether an empty watch namespace is forbidden. */
  requireWatchNamespace: boolean;
  /** Immutable tenant runtime image. */
  tenantDefaultImage: string;
  /** Base ingress domain for tenant runtime hosts. */
  ingressDomain: string;
  /** External ingress address used by managed DNS. */
  ingressIp: string;
  /** cert-manager issuer name. */
  certManagerIssuerName: string;
  /** cert-manager issuer kind. */
  certManagerIssuerKind: "ClusterIssuer" | "Issuer";
  /** Whether rendered tenant ingress uses TLS. */
  ingressTlsEnabled: boolean;
  /** Wildcard TLS secret name. */
  ingressTlsSecretName: string;
  /** OpenClaw gateway port. */
  gatewayPort: number;
  /** CIDRs allowed to assert the trusted proxy identity header. */
  gatewayTrustedProxies: string[];
  /** Whether the trusted proxy boundary denies every source. */
  gatewayTrustNothing: boolean;
  /** Header carrying the proxy-authenticated user. */
  gatewayTrustedProxyUserHeader: string;
  /** Namespace hosting the control-plane process. */
  operatorNamespace: string;
  /** Whether the in-process channel proxy is enabled. */
  gatewayProxyEnabled: boolean;
  /** Channel proxy listener port. */
  gatewayProxyPort: number;
  /** Kubernetes cluster DNS suffix. */
  clusterDomain: string;
  /** Exact browser origins accepted for channel upgrades. */
  gatewayProxyAllowedOrigins: string[];
  /** Base domains accepted for org-host channel upgrades. */
  gatewayProxyAllowedOriginBaseDomains: string[];
  /** Per-user channel upgrade rate limit. */
  gatewayProxyRateLimitPerMinute: number;
  /** Active tenant hosting substrate. */
  hostingProvider: HostingProvider;
  /** GCP-specific hosting settings. */
  gcp?: GcpHostingConfig;
  /** Storage class for tenant state volumes. */
  tenantStorageClassName: string;
  /** Minutes of inactivity before suspension. */
  idleTimeoutMinutes: number;
  /** Idle-policy sweep interval in seconds. */
  idleCheckIntervalSeconds: number;
  /** Whether LiteLLM tenant-key provisioning is enabled. */
  liteLlmEnabled: boolean;
  /** LiteLLM API endpoint. */
  liteLlmEndpoint: string;
  /** LiteLLM administrative key. */
  liteLlmMasterKey: string;
  /** Default tenant monthly LiteLLM budget. */
  liteLlmDefaultMonthlyBudgetUsd: number;
  /** LiteLLM budget reset duration. */
  liteLlmBudgetDuration: string;
  /** Default per-tenant token-per-minute limit. */
  liteLlmDefaultTpmLimit: number;
  /** Default per-tenant request-per-minute limit. */
  liteLlmDefaultRpmLimit: number;
  /** Dedicated monthly budget for Cognee. */
  cogneeLiteLlmMonthlyBudgetUsd: number;
  /** Default AccessPolicy reference for new tenants. */
  defaultTenantPolicyRef: string;
  /** MCP gateway service URL rendered into tenant config. */
  mcpGatewayUrl: string;
  /** Cognee service endpoint. */
  cogneeEndpoint: string;
  /** Internal listener port. */
  internalPort: number;
  /** Process-local internal API URL. */
  controlPlaneInternalUrl: string;
  /** In-cluster internal API service URL. */
  controlPlaneInternalServiceUrl: string;
  /** Projected service-account token lifetime. */
  projectedTokenTtlSeconds: number;
  /** Whether the silo may create tenant namespaces. */
  manageTenantNamespaces: boolean;
  /** Silo topology mode. */
  deploymentMode: "standalone" | "fleet-managed";
  /** Standalone ClusterTenant seed name. */
  standaloneSeedName: string;
  /** Standalone ClusterTenant display name. */
  standaloneSeedDisplayName: string;
  /** Standalone ClusterTenant owner email. */
  standaloneSeedOwnerEmail: string;
  /** Standalone ClusterTenant owner subject. */
  standaloneSeedOwnerSubject: string;
  /** Standalone ClusterTenant isolation tier. */
  standaloneSeedTier: string;
  /** Whether this silo owns its public domain resources. */
  manageOwnDomain: boolean;
}
