/**
 * OpenCrane Control Plane — OpenAPI 3.1 specification.
 *
 * This is the single source of truth for the HTTP API contract.
 * Edit this file when you add or change routes, then run:
 *   npm run emit-openapi -w @opencrane/server
 *   nx run contracts:generate
 * and commit the regenerated contracts client alongside the code change.
 *
 * The generated openapi.json is a dist artifact, not source.
 */

// ---------------------------------------------------------------------------
// Domain path imports
// ---------------------------------------------------------------------------

import { _AwarenessOpenapiPaths } from "@opencrane/backend/server/reporting/awareness";
import { _TenantsOpenapiPaths } from "@opencrane/backend/server/tenancy/tenants";
import { _ProjectionOpenapiPaths } from "@opencrane/backend/server/tenancy/projection";
import { _PoliciesOpenapiPaths } from "@opencrane/backend/server/iam/policies";
import { _McpOpenapiPaths } from "@opencrane/backend/server/gateways/mcp";
import { _GrantsOpenapiPaths } from "@opencrane/backend/server/iam/grants";
import { _GroupsOpenapiPaths } from "@opencrane/backend/server/iam/groups";
import { _RetrievalOpenapiPaths } from "@opencrane/backend/server/knowledge/retrieval";
import { _ProvidersOpenapiPaths } from "@opencrane/backend/server/gateways/providers";
import { _ModelRoutingOpenapiPaths } from "@opencrane/backend/server/gateways/model-routing";
import { _SpendOpenapiPaths } from "@opencrane/backend/server/reporting/spend";
import { _AuditOpenapiPaths } from "@opencrane/backend/server/iam/audit";
import { _MetricsOpenapiPaths } from "@opencrane/backend/server/reporting/metrics";

// ---------------------------------------------------------------------------
// Reusable schema components
// ---------------------------------------------------------------------------

const ErrorEnvelope = {
  type: "object" as const,
  required: ["error", "code"],
  properties: {
    error: { type: "string", description: "Human-readable error description." },
    code: { type: "string", description: "Machine-readable error code." },
    detail: { type: "string", description: "Optional extra context." },
  },
};

const Pagination = {
  type: "object" as const,
  required: ["limit", "hasMore"],
  properties: {
    limit: { type: "integer", minimum: 1, maximum: 1000 },
    nextCursor: { type: "string", description: "Opaque cursor for the next page. Absent when hasMore is false." },
    hasMore: { type: "boolean" },
  },
};

// Common response helpers
function notFound(description: string)
{
  return {
    description,
    content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
  };
}

function badRequest(description: string)
{
  return {
    description,
    content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
  };
}

function conflict(description: string)
{
  return {
    description,
    content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
  };
}

function unprocessable(description: string)
{
  return {
    description,
    content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
  };
}

function unauthorized(description: string)
{
  return {
    description,
    content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
  };
}

function forbidden(description: string)
{
  return {
    description,
    content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
  };
}

function upstreamError()
{
  return {
    description: "Upstream dependency (Kubernetes, database, Cognee, LiteLLM) returned an error.",
    content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
  };
}

function ok(description: string, schema: object)
{
  return {
    description,
    content: { "application/json": { schema } },
  };
}

function created(description: string, schema: object)
{
  return {
    description,
    content: { "application/json": { schema } },
  };
}

// ---------------------------------------------------------------------------
// Shared schema references
// ---------------------------------------------------------------------------

const TenantSchema = {
  type: "object" as const,
  properties: {
    name: { type: "string" },
    displayName: { type: "string" },
    email: { type: "string", format: "email" },
    subject: { type: "string", description: "IdP-verified subject (OIDC `sub`) this workspace is bound to; the contract compiler inherits the user's rights over {tenant, subject, groups}. Absent only on legacy/imported tenants." },
    team: { type: "string" },
    clusterTenantRef: { type: "string", description: "Parent ClusterTenant (customer) this tenant attaches to; absent on the single-instance path." },
    phase: { type: "string" },
    ingressHost: { type: "string" },
    createdAt: { type: "string", format: "date-time" },
  },
};

const PolicySchema = {
  type: "object" as const,
  properties: {
    name: { type: "string" },
    namespace: { type: "string" },
    tenantSelector: { type: "object" },
    domains: { type: "array", items: { type: "string" } },
    egressRules: { type: "array", items: { type: "object" } },
    mcpServers: { type: "object" },
    createdAt: { type: "string", format: "date-time" },
  },
};

const McpServerCredentialSchema = {
  type: "object" as const,
  properties: {
    id: { type: "string", description: "Stable credential identifier." },
    displayName: { type: "string", description: "Operator-facing label." },
  },
};

const McpServerCredentialInputSchema = {
  type: "object" as const,
  required: ["displayName"],
  properties: {
    displayName: { type: "string", description: "Operator-facing label." },
  },
};

const McpServerSchema = {
  type: "object" as const,
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    endpoint: { type: "string" },
    transport: { type: "string", enum: ["streamable-http", "sse", "websocket"] },
    grants: { type: "array", items: { type: "object" } },
    credentials: { type: "array", items: { $ref: "#/components/schemas/McpServerCredential" } },
  },
};

const CredentialFieldSchema = {
  type: "object" as const,
  required: ["key", "label", "required", "sensitive"],
  properties: {
    key: { type: "string", description: "Stable key the value is submitted under." },
    label: { type: "string", description: "Human-readable field label." },
    required: { type: "boolean", description: "Whether the field must be supplied." },
    sensitive: { type: "boolean", description: "Whether the value is secret (masked, never echoed back)." },
    placeholder: { type: "string", description: "Optional input placeholder." },
    hint: { type: "string", description: "Optional helper hint." },
  },
};

const McpCatalogServerSchema = {
  type: "object" as const,
  required: ["id"],
  description: "A catalogue server as exposed by the operator API (distinct from the registry McpServer). Every field beyond id is optional so the same shape serves the entitled user catalogue and the admin governance view.",
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    description: { type: "string" },
    publisher: { type: "string" },
    glyph: { type: "string" },
    type: { type: "string", enum: ["single-user", "multi-user", "remote-oauth"], description: "Consumption shape; decides the credential-connect flow." },
    approvalStatus: { type: "string", enum: ["pending-review", "approved", "published", "disabled"], description: "Governance lifecycle status." },
    credentialSchema: { type: "array", items: { $ref: "#/components/schemas/CredentialField" } },
    entitlementSummary: { type: "string", description: "Human-readable summary of who is entitled (admin view)." },
  },
};

const McpInstalledSchema = {
  type: "object" as const,
  required: ["serverId"],
  description: "A server installed by the calling user. Never carries credential material — only the connection status and a non-secret account label.",
  properties: {
    serverId: { type: "string" },
    connectionStatus: { type: "string", enum: ["needs-credential", "activating", "connected", "oauth-connected", "shared-key", "activation-failed"] },
    lastUsed: { type: ["string", "null"], format: "date-time", description: "ISO-8601 timestamp of last use, or null when never used." },
    connectedAccount: { type: "string", description: "Non-secret display label of the connected account." },
  },
};

const EntitledUserSchema = {
  type: "object" as const,
  required: ["id", "name", "initials", "color"],
  properties: {
    id: { type: "string", description: "Stable user identifier (sub or email)." },
    name: { type: "string", description: "Display name." },
    initials: { type: "string", description: "Two-letter initials derived from the name." },
    color: { type: "string", description: "Deterministic avatar colour derived from the identifier." },
  },
};

const McpAccessPolicySchema = {
  type: "object" as const,
  required: ["serverId"],
  properties: {
    serverId: { type: "string" },
    everyoneInOrg: { type: "boolean", description: "When true, every caller in the org is entitled (lists ignored)." },
    groups: { type: "array", items: { type: "string" }, description: "Entitled group identifiers / names." },
    users: { type: "array", items: { $ref: "#/components/schemas/EntitledUser" } },
  },
};

const McpDirectorySchema = {
  type: "object" as const,
  required: ["users", "groups"],
  description: "The selectable universe of users and groups for the admin access editor.",
  properties: {
    users: { type: "array", items: { $ref: "#/components/schemas/EntitledUser" } },
    groups: { type: "array", items: { type: "string" } },
  },
};

const ClusterTenantResourceQuotaSchema = {
  type: "object" as const,
  properties: {
    cpu: { type: "string", description: "Total CPU the customer may request (e.g. '4', '500m')." },
    memory: { type: "string", description: "Total memory the customer may request (e.g. '8Gi')." },
    pods: { type: "integer", description: "Maximum number of pods the customer may run." },
    storage: { type: "string", description: "Total persistent storage the customer may claim (e.g. '100Gi')." },
    gpu: { type: "integer", description: "Total GPUs the customer may request." },
  },
};

const ClusterTenantSchema = {
  type: "object" as const,
  required: ["name", "displayName", "isolationTier", "compute", "resources"],
  properties: {
    name: { type: "string", description: "Stable cluster-scoped identifier (the customer key)." },
    displayName: { type: "string", description: "Human-readable customer name." },
    vanityDomain: { type: "string", description: "Optional customer-vanity domain CNAMEd onto the org's derived apex (<name>.<platformBaseDomain>); an overlay, not the org identity. When unset, only the derived apex serves the org." },
    isolationTier: { type: "string", enum: ["shared", "dedicatedNodes", "dedicatedCluster"], description: "Isolation strength chosen for this customer." },
    compute: {
      type: "object",
      required: ["mode"],
      properties: {
        mode: { type: "string", enum: ["shared", "dedicated"] },
        nodePool: { type: "string", description: "Dedicated node pool name; required when mode is 'dedicated'." },
      },
    },
    resources: {
      type: "object",
      required: ["quota"],
      properties: { quota: { $ref: "#/components/schemas/ClusterTenantResourceQuota" } },
    },
    status: {
      type: "object",
      properties: {
        phase: { type: "string", enum: ["pending", "provisioning", "ready", "failed"] },
        message: { type: "string" },
        boundNamespace: { type: "string" },
        provisioner: { type: "string" },
      },
    },
  },
};

const ClusterTenantWriteSchema = {
  type: "object" as const,
  required: ["name", "displayName", "isolationTier", "compute", "resources"],
  properties: {
    name: { type: "string", description: "Stable cluster-scoped identifier (the customer key)." },
    displayName: { type: "string", description: "Human-readable customer name." },
    vanityDomain: { type: "string", description: "Optional customer-vanity domain CNAMEd onto the org's derived apex (<name>.<platformBaseDomain>); an overlay, not the org identity." },
    isolationTier: { type: "string", enum: ["shared", "dedicatedNodes", "dedicatedCluster"] },
    compute: {
      type: "object",
      required: ["mode"],
      properties: {
        mode: { type: "string", enum: ["shared", "dedicated"] },
        nodePool: { type: "string" },
      },
    },
    resources: {
      type: "object",
      required: ["quota"],
      properties: { quota: { $ref: "#/components/schemas/ClusterTenantResourceQuota" } },
    },
  },
};

const ClusterTenantUpdateSchema = {
  type: "object" as const,
  description: "Partial cluster-tenant update; the immutable name comes from the path. Every field is optional — only those present are changed.",
  properties: {
    displayName: { type: "string", description: "New human-readable customer name (must be non-blank when present)." },
    vanityDomain: { type: "string", description: "New customer-vanity domain CNAMEd onto the org apex; an empty string clears it (back to the derived <name>.<base> apex only)." },
    isolationTier: { type: "string", enum: ["shared", "dedicatedNodes", "dedicatedCluster"], description: "New isolation strength; re-gated against the provisioner registry when changed." },
    compute: {
      type: "object",
      required: ["mode"],
      properties: {
        mode: { type: "string", enum: ["shared", "dedicated"] },
        nodePool: { type: "string", description: "Dedicated node pool name; required when mode is 'dedicated'." },
      },
    },
    resources: {
      type: "object",
      required: ["quota"],
      properties: { quota: { $ref: "#/components/schemas/ClusterTenantResourceQuota" } },
    },
  },
};

const OrgMemberSchema = {
  type: "object" as const,
  required: ["subject", "role"],
  description: "A single organisation membership row — the LOCAL membership registry the org-admin gate reads (an OrgMembership, NOT a Zitadel grant).",
  properties: {
    subject: { type: "string", description: "IdP-verified subject (OIDC `sub`) holding the membership." },
    role: { type: "string", enum: ["Owner", "Admin", "Member"], description: "Role held within the organisation." },
  },
};

const OrgMemberWriteSchema = {
  type: "object" as const,
  required: ["subject", "role"],
  description: "Add or update an organisation member (upsert on the unique [org, subject]).",
  properties: {
    subject: { type: "string", description: "IdP-verified subject (OIDC `sub`) of the member to add/update." },
    role: { type: "string", enum: ["Owner", "Admin", "Member"], description: "Role to grant within the organisation." },
  },
};

const GroupSchema = {
  type: "object" as const,
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    description: { type: "string" },
    memberCount: { type: "integer" },
    awarenessGrants: { type: "array", items: { type: "object" } },
  },
};

const AuditEntrySchema = {
  type: "object" as const,
  properties: {
    timestamp: { type: "string", format: "date-time" },
    tenant: { type: "string" },
    action: { type: "string" },
    resource: { type: "string" },
    message: { type: "string" },
  },
};

const ByokProviderKeyStatusSchema = {
  type: "object" as const,
  required: ["provider", "configured", "litellmRegistered"],
  properties: {
    provider: { type: "string", enum: ["openai", "anthropic", "gemini", "mistral", "deepseek", "glm"], description: "The provider this status describes." },
    configured: { type: "boolean", description: "Whether a key is currently set for this provider in this silo." },
    litellmRegistered: { type: "boolean", description: "Whether LiteLLM's /credentials dynamic path accepted the key (false ⇒ Secret-only)." },
    updatedAt: { type: "string", format: "date-time", nullable: true, description: "When the key was last set; null when not configured." },
  },
};

const ProviderKeySetRequestSchema = {
  type: "object" as const,
  required: ["apiKey"],
  properties: {
    apiKey: { type: "string", description: "The raw upstream provider API key. Accepted only over HTTPS; written to a k8s Secret + LiteLLM and never returned by any read." },
  },
};

const ProviderCredentialSchema = {
  type: "object" as const,
  required: ["id", "scope", "provider", "secretRef"],
  properties: {
    id: { type: "string", description: "Stable identifier." },
    scope: { type: "string", enum: ["global", "clusterTenant"], description: "Whether the credential is platform-wide or owned by one ClusterTenant." },
    clusterTenant: { type: "string", nullable: true, description: "Owning ClusterTenant when scope is clusterTenant; null for Global." },
    provider: { type: "string", description: "Free-text provider key (e.g. openai, anthropic, bedrock)." },
    secretRef: { type: "string", description: "Name of the External-Secrets-synced k8s Secret carrying the provider key (never the raw key)." },
    litellmCredentialName: { type: "string", nullable: true, description: "LiteLLM /credentials name when registered for the dynamic path; null for the env baseline." },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
  },
};

const ProviderCredentialWriteSchema = {
  type: "object" as const,
  required: ["provider", "secretRef"],
  properties: {
    scope: { type: "string", enum: ["global", "clusterTenant"], description: "Defaults to global when omitted." },
    clusterTenant: { type: "string", description: "Required when scope is clusterTenant." },
    provider: { type: "string", description: "Free-text provider key." },
    secretRef: { type: "string", description: "Name of the External-Secrets-synced k8s Secret carrying the provider key. A raw key field (apiKey/keyValue/key) is rejected with 400." },
    litellmCredentialName: { type: "string", description: "Optional LiteLLM /credentials name for the dynamic no-restart path." },
  },
};

const ModelDefinitionSchema = {
  type: "object" as const,
  required: ["id", "scope", "publicModelName", "litellmModelId", "upstreamModel", "isDefault"],
  properties: {
    id: { type: "string", description: "Stable identifier." },
    scope: { type: "string", enum: ["global", "clusterTenant"], description: "Whether the model is platform-wide or owned by one ClusterTenant." },
    clusterTenant: { type: "string", nullable: true, description: "Owning ClusterTenant when scope is clusterTenant; null for Global." },
    publicModelName: { type: "string", description: "The routable public slug callers request, e.g. openai/gpt-4o." },
    litellmModelId: { type: "string", description: "Deployment id returned by LiteLLM /model/new (or a deterministic placeholder when LiteLLM is unconfigured)." },
    upstreamModel: { type: "string", description: "Upstream model the deployment targets." },
    apiBase: { type: "string", nullable: true, description: "Optional non-default API base for self-hosted / proxied endpoints." },
    isDefault: { type: "boolean", description: "Whether this is the default model at its scope." },
    providerCredentialId: { type: "string", nullable: true, description: "The provider credential backing this model, when set." },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
  },
};

const ModelDefinitionWriteSchema = {
  type: "object" as const,
  required: ["publicModelName", "upstreamModel"],
  properties: {
    scope: { type: "string", enum: ["global", "clusterTenant"], description: "Defaults to global when omitted." },
    clusterTenant: { type: "string", description: "Required when scope is clusterTenant." },
    publicModelName: { type: "string", description: "The routable public slug, e.g. openai/gpt-4o." },
    upstreamModel: { type: "string", description: "Upstream model the deployment targets." },
    apiBase: { type: "string", description: "Optional non-default API base." },
    isDefault: { type: "boolean", description: "Whether this is the default model at its scope." },
    providerCredentialId: { type: "string", description: "Provider credential backing this model." },
  },
};

const AutoRoutingConfigSchema = {
  type: "object" as const,
  required: ["objective", "sessionPin", "explorationRate"],
  description: "Opt-in auto-routing configuration. Auto routing applies ONLY when a skill (or scope default) selects it; the runtime optimizer that consumes it is a later track item (AIR.7).",
  properties: {
    objective: { type: "string", enum: ["cheapest-passing-bar", "best-quality-within-budget", "balanced"], description: "The optimization objective." },
    costQualitySlider: { type: "number", description: "Cost↔quality dial for the balanced objective: 0 = cheapest … 10 = best." },
    qualityFloor: { type: "number", description: "Minimum eval score a model must clear; defaults to the skill's own bar when omitted." },
    maxBudgetUsd: { type: "number", description: "Hard per-decision spend ceiling in USD." },
    allowedModels: { type: "array", items: { type: "string" }, description: "Restrict auto to this subset of publicModelNames; must stay within the key's allowlist." },
    latencyCeilingMs: { type: "number", description: "Reject/penalize models slower than this many milliseconds." },
    fallbacks: { type: "array", items: { type: "string" }, description: "Ordered fallback publicModelNames on failure/unavailability." },
    sessionPin: { type: "boolean", description: "Keep the chosen model stable within a conversation to preserve prompt caches." },
    explorationRate: { type: "number", minimum: 0, maximum: 1, description: "Fraction of traffic to explore alternatives on (0 = pure exploit)." },
  },
};

const ModelRoutingDefaultSchema = {
  type: "object" as const,
  required: ["id", "scope"],
  properties: {
    id: { type: "string", description: "Stable identifier." },
    scope: { type: "string", enum: ["global", "clusterTenant"], description: "Whether this default is platform-wide or per-ClusterTenant." },
    clusterTenant: { type: "string", nullable: true, description: "Owning ClusterTenant when scope is clusterTenant; null for Global." },
    defaultModel: { type: "string", nullable: true, description: "Default model publicModelName at this scope; null when unset." },
    autoConfig: { ...AutoRoutingConfigSchema, nullable: true, description: "Default auto-routing config at this scope; null when unset." },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
  },
};

const ModelRoutingDefaultWriteSchema = {
  type: "object" as const,
  description: "Upsert body for a scope-level model-routing default. At least one of defaultModel or autoConfig is required.",
  properties: {
    scope: { type: "string", enum: ["global", "clusterTenant"], description: "Defaults to global when omitted." },
    clusterTenant: { type: "string", description: "Required when scope is clusterTenant." },
    defaultModel: { type: "string", description: "Default model publicModelName." },
    autoConfig: { ...AutoRoutingConfigSchema, description: "Default auto-routing config." },
  },
};

const DatasetMembershipSchema = {
  type: "object" as const,
  required: ["org", "team", "department", "project", "personal"],
  properties: {
    org: { type: "array", items: { type: "string" } },
    team: { type: "array", items: { type: "string" } },
    department: { type: "array", items: { type: "string" } },
    project: { type: "array", items: { type: "string" } },
    personal: { type: "array", items: { type: "string" } },
  },
};

const EffectiveContractSchema = {
  type: "object" as const,
  properties: {
    contractId: { type: "string" },
    contractVersion: { type: "string" },
    tenant: { type: "object" },
    awareness: { type: "object" },
    mcp: { type: "object" },
  },
};

const ProjectionDriftSchema = {
  type: "object" as const,
  properties: {
    tenant: { type: "object" },
    accessPolicy: { type: "object" },
    evaluatedAt: { type: "string", format: "date-time" },
    alertFired: { type: "boolean" },
  },
};

const BudgetSchema = {
  type: "object" as const,
  properties: {
    monthlyLimitUsd: { type: "number" },
    currentSpendUsd: { type: "number" },
    budgetAlertState: { type: "string", enum: ["ok", "warning", "exceeded"] },
  },
};

const ThirdPartySourceSchema = {
  type: "object" as const,
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    type: { type: "string" },
    url: { type: "string" },
    syncStatus: { type: "string" },
    lastSyncedAt: { type: "string", format: "date-time" },
  },
};

const TokenUsageSchema = {
  type: "object" as const,
  properties: {
    tenant: { type: "string" },
    model: { type: "string" },
    inputTokens: { type: "integer" },
    outputTokens: { type: "integer" },
    totalCostUsd: { type: "number" },
    recordedAt: { type: "string", format: "date-time" },
  },
};

// ---------------------------------------------------------------------------
// Cursor-paginated response wrapper
// ---------------------------------------------------------------------------

function paginated(itemSchema: object)
{
  return {
    type: "object" as const,
    required: ["data", "pagination"],
    properties: {
      data: { type: "array", items: itemSchema },
      pagination: { $ref: "#/components/schemas/Pagination" },
    },
  };
}

// ---------------------------------------------------------------------------
// Spec document — Composed from domain path fragments
// ---------------------------------------------------------------------------

/** OpenAPI 3.1 document served by the control plane and emitted for SDK generation. */
export const spec = {
  openapi: "3.1.0",
  info: {
    title: "OpenCrane Control Plane API",
    version: "1.0.0",
    description: "Multi-tenant AI agent platform management API.\n\n**Authentication**\n\n- *Human operators* — OIDC browser flow via `GET /auth/login` → `/auth/callback`. Session cookie is set server-side.\n- In-cluster workloads use short-lived, audience-bound projected service-account tokens at their dedicated internal trust boundaries.\n- Endpoints tagged *Auth* and *Meta* (`/auth/*`, `/openapi.json`) require no credentials.",
  },
  servers: [
    { url: "/api/v1", description: "Versioned API prefix" },
  ],
  components: {
    schemas: {
      Error: ErrorEnvelope,
      Pagination,
      Tenant: TenantSchema,
      Policy: PolicySchema,
      McpServer: McpServerSchema,
      McpServerCredential: McpServerCredentialSchema,
      McpCatalogServer: McpCatalogServerSchema,
      CredentialField: CredentialFieldSchema,
      McpInstalled: McpInstalledSchema,
      McpAccessPolicy: McpAccessPolicySchema,
      EntitledUser: EntitledUserSchema,
      McpDirectory: McpDirectorySchema,
      ClusterTenant: ClusterTenantSchema,
      ClusterTenantWrite: ClusterTenantWriteSchema,
      ClusterTenantUpdate: ClusterTenantUpdateSchema,
      ClusterTenantResourceQuota: ClusterTenantResourceQuotaSchema,
      OrgMember: OrgMemberSchema,
      OrgMemberWrite: OrgMemberWriteSchema,
      Group: GroupSchema,
      Share: {
        type: "object",
        description: "An inter-user share: an Allow grant the caller created on a recipient for an entitlement they hold (S4).",
        properties: {
          id: { type: "string" },
          payloadType: { type: "string", enum: ["mcp-server"], description: "The MCP entitlement family shared." },
          payloadId: { type: "string", description: "Id of the shared MCP server." },
          recipientType: { type: "string", enum: ["user", "group"], description: "Whether the share targets a user (IdP subject) or a group." },
          recipientId: { type: "string", description: "The recipient user subject or group id." },
          scope: { type: "string", enum: ["org", "department", "project", "personal"] },
          note: { type: "string" },
          sharedBy: { type: "string", description: "IdP subject of the user who created the share." },
          createdAt: { type: "string", format: "date-time" },
        },
        required: ["id", "payloadType", "payloadId", "recipientType", "recipientId", "scope", "createdAt"],
      },
      ResourceShare: {
        type: "object",
        description: "A direct share of a file/chat (S4c): the resource-scoped Personal group whose members can access it.",
        properties: {
          groupId: { type: "string", description: "Id of the resource-scoped share group." },
          resourceType: { type: "string", enum: ["file", "chat", "dataset"] },
          resourceId: { type: "string" },
          members: { type: "array", items: { type: "string" }, description: "IdP subjects the resource is shared with (incl. the owner)." },
        },
        required: ["groupId", "resourceType", "resourceId", "members"],
      },
      AuditEntry: AuditEntrySchema,
      ByokProviderKeyStatus: ByokProviderKeyStatusSchema,
      ProviderKeySetRequest: ProviderKeySetRequestSchema,
      ProviderCredential: ProviderCredentialSchema,
      ProviderCredentialWrite: ProviderCredentialWriteSchema,
      ModelDefinition: ModelDefinitionSchema,
      ModelDefinitionWrite: ModelDefinitionWriteSchema,
      AutoRoutingConfig: AutoRoutingConfigSchema,
      ModelRoutingDefault: ModelRoutingDefaultSchema,
      ModelRoutingDefaultWrite: ModelRoutingDefaultWriteSchema,
      AwarenessRollout: {
        type: "object",
        properties: {
          targetVersion: { type: "string" },
          stableVersion: { type: "string" },
          waves: { type: "array", items: { type: "string" } },
          promotedWaves: { type: "array", items: { type: "string" } },
          shadowMode: { type: "boolean" },
          nextWave: { type: "string", nullable: true },
        },
      },
      DatasetMembership: DatasetMembershipSchema,
      EffectiveContract: EffectiveContractSchema,
      ProjectionDrift: ProjectionDriftSchema,
      Budget: BudgetSchema,
      ThirdPartySource: ThirdPartySourceSchema,
      TokenUsage: TokenUsageSchema,
      ZitadelCandidateKeyValidation: {
        type: "object",
        required: ["tokenExchangeOk", "instanceScopeOk", "keyId", "detail"],
        properties: {
          tokenExchangeOk: { type: "boolean", description: "Whether the candidate key's jwt-bearer token exchange succeeded." },
          instanceScopeOk: { type: "boolean", description: "Whether the candidate key passed the non-destructive instance IAM_OWNER probe." },
          keyId: { type: "string", nullable: true, description: "The candidate key's keyId, or null when the key was malformed." },
          detail: { type: "string", description: "Human-readable validation detail (never contains key material)." },
        },
      },
      ZitadelKeyRotateRequest: {
        type: "object",
        required: ["serviceAccountKey"],
        properties: {
          serviceAccountKey: {
            description: "The candidate Zitadel service-account key — a JSON string (the downloaded key file) or the equivalent JSON object.",
            oneOf: [{ type: "string" }, { type: "object" }],
          },
        },
      },
      ZitadelKeyRotateResult: {
        type: "object",
        required: ["rotated", "validation"],
        properties: {
          rotated: { type: "boolean", description: "True only when the live key was replaced (both validation flags passed and the Secret persisted)." },
          keyId: { type: "string", description: "The newly-active key's keyId (present only when rotated)." },
          previousKeyId: { type: "string", description: "The keyId that was active before the swap (present only when rotated)." },
          validation: { $ref: "#/components/schemas/ZitadelCandidateKeyValidation" },
        },
      },
      ZitadelReconcileRequest: {
        type: "object",
        properties: {
          name: { type: "string", description: "When set, reconcile ONLY this ClusterTenant; when absent, scan the whole fleet." },
        },
      },
      ZitadelReconcileSummary: {
        type: "object",
        required: ["reconciled", "skipped", "failed"],
        properties: {
          reconciled: { type: "array", items: { type: "string" }, description: "Names of ClusterTenants whose Zitadel ids were (re-)provisioned and persisted." },
          skipped: {
            type: "array",
            description: "ClusterTenants left untouched, with the reason.",
            items: {
              type: "object",
              required: ["name", "reason"],
              properties: {
                name: { type: "string" },
                reason: { type: "string", enum: ["already-provisioned", "no-owner"] },
              },
            },
          },
          failed: {
            type: "array",
            description: "ClusterTenants whose reconcile threw (a per-CT failure never aborts the run).",
            items: {
              type: "object",
              required: ["name", "error"],
              properties: {
                name: { type: "string" },
                error: { type: "string", description: "Human-readable error detail (never key material)." },
              },
            },
          },
        },
      },
    },
  },
  paths: {
    // Compose domain paths in order — order matters for JSON serialization byte-identity
    ..._AwarenessOpenapiPaths,
    ..._TenantsOpenapiPaths,
    ..._ProjectionOpenapiPaths,
    ..._PoliciesOpenapiPaths,
    ..._McpOpenapiPaths,
    ..._GrantsOpenapiPaths,
    ..._GroupsOpenapiPaths,
    ..._RetrievalOpenapiPaths,
    ..._ProvidersOpenapiPaths,
    ..._ModelRoutingOpenapiPaths,
    ..._SpendOpenapiPaths,
    ..._AuditOpenapiPaths,
    ..._MetricsOpenapiPaths,

    // ------------------------------------------------------------------
    // Auth — OIDC browser flow and session introspection
    // Human operators: OIDC browser flow.
    // ------------------------------------------------------------------

    "/auth/me": {
      get: {
        operationId: "getAuthStatus",
        summary: "Return current auth mode and authenticated user identity (if any)",
        description: "No authentication required. Returns 200 with the current session or an anonymous identity when no session is established.",
        tags: ["Auth"],
        security: [],
        responses: {
          200: ok("Auth status.", {
            type: "object",
            required: ["mode", "authenticated"],
            properties: {
              mode: { type: "string", enum: ["development", "oidc"], description: "Active authentication mode for this instance." },
              authenticated: { type: "boolean" },
              user: {
                type: "object",
                nullable: true,
                required: ["sub", "issuer", "groups", "isPlatformOperator", "isOrgAdmin"],
                properties: {
                  sub: { type: "string" },
                  issuer: { type: "string", description: "Identity provider that authenticated the user." },
                  groups: { type: "array", items: { type: "string" }, description: "The caller's group memberships from the OIDC groups claim (empty when none)." },
                  isPlatformOperator: {
                    type: "boolean",
                    description: "True iff the caller's groups intersect OPENCRANE_PLATFORM_OPERATOR_GROUPS. Empty/unset config ⇒ false (fail-closed). Introspection only — the API stays the enforcement point and the frontend uses this only to hide UI. Superseded once a first-class role model lands.",
                  },
                  isOrgAdmin: {
                    type: "boolean",
                    description: "True iff the caller is an organisation admin (groups intersect OPENCRANE_ORG_ADMIN_GROUPS, or the caller is a platform operator). Gates MCP-catalogue curation/approval (requireOrgAdmin). Empty/unset config ⇒ false (fail-closed). Introspection only — the API stays the enforcement point.",
                  },
                  clusterTenant: {
                    type: ["string", "null"],
                    description: "The caller's ClusterTenant (customer) key, resolved server-side from their IdP-verified email → tenant → clusterTenantRef. Null when unresolved or ambiguous.",
                  },
                  ownedOrgs: {
                    type: "array",
                    description: "Organisations the caller owns or administers, derived fresh from their OrgMembership rows (owner/admin only; members excluded). Empty when the caller administers no org. The org-scope half of the membership-derived isOrgAdmin. Introspection only — never taken from request input.",
                    items: {
                      type: "object",
                      required: ["clusterTenant", "role"],
                      properties: {
                        clusterTenant: { type: "string", description: "The organisation (ClusterTenant) key." },
                        role: { type: "string", enum: ["owner", "admin"], description: "The administering role the caller holds in this org." },
                      },
                    },
                  },
                  email: { type: "string" },
                  emailVerified: { type: "boolean" },
                  name: { type: "string" },
                  picture: { type: "string" },
                  authenticatedAt: { type: "string", format: "date-time" },
                },
              },
            },
          }),
        },
      },
    },

    "/auth/pod-token": {
      post: {
        operationId: "getPodConnection",
        summary: "Resolve the caller's OpenClaw pod gateway connection coordinates from their OIDC session",
        description: "Single sign-on across the control plane and the tenant pod: requires an established OIDC session (cookie) and returns the `wss://` gateway URL for the caller's own pod. Under trusted-proxy gateway auth the browser holds no credential — the gateway socket is authorised against the live session through `/auth/gateway-resolve`, so no token is returned. The tenant is resolved solely from the session's verified email, so a caller cannot obtain another user's pod connection. Returns 401 without a session, 403 when no tenant matches the session email, 409 when the pod has no gateway URL / ingress host yet or when the email maps to more than one tenant.",
        tags: ["Auth"],
        security: [],
        responses: {
          200: ok("The caller's OpenClaw pod gateway connection coordinates.", {
            type: "object",
            required: ["gatewayUrl", "tenant"],
            properties: {
              gatewayUrl: { type: "string", description: "The `wss://` OpenClaw gateway URL to open." },
              tenant: { type: "string", description: "Resolved tenant (pod) name." },
              ingressHost: { type: "string", description: "Host the tenant's OpenClaw pod is reachable at, when known." },
            },
          }),
          401: ok("No authenticated session.", {
            type: "object",
            properties: { error: { type: "string" }, code: { type: "string" } },
          }),
          403: ok("Session has no email claim, or no tenant is provisioned for it.", {
            type: "object",
            properties: { error: { type: "string" }, code: { type: "string" } },
          }),
          409: ok("The tenant pod has no gateway URL / ingress host yet.", {
            type: "object",
            properties: { error: { type: "string" }, code: { type: "string" } },
          }),
        },
      },
    },

    "/auth/login": {
      get: {
        operationId: "startOidcLogin",
        summary: "Redirect the browser to the configured OIDC identity provider to start login",
        description: "Browser redirect — not intended for programmatic use. Returns 503 when OIDC is not configured.",
        tags: ["Auth"],
        security: [],
        parameters: [
          { name: "returnTo", in: "query", schema: { type: "string" }, description: "Path to redirect back to after a successful login." },
        ],
        responses: {
          302: { description: "Redirect to identity provider." },
          503: { description: "OIDC not configured.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        },
      },
    },

    "/auth/callback": {
      get: {
        operationId: "completeOidcLogin",
        summary: "OIDC authorization callback — validates the response and establishes a session",
        description: "Called by the identity provider after a successful login. Redirects back to the SPA.",
        tags: ["Auth"],
        security: [],
        parameters: [
          { name: "code", in: "query", schema: { type: "string" } },
          { name: "state", in: "query", schema: { type: "string" } },
        ],
        responses: {
          302: { description: "Redirect back into the application." },
          503: { description: "OIDC not configured.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        },
      },
    },

    "/auth/logout": {
      post: {
        operationId: "logout",
        summary: "Destroy the current session and return the IdP RP-initiated logout URL",
        description: "Invalidates the server-side session. When OIDC is enabled and the identity provider advertises an `end_session_endpoint`, returns the URL the browser should navigate to so the upstream IdP session is also terminated (OIDC RP-Initiated Logout). The local session is always destroyed; `endSessionUrl` is null when no upstream logout is possible (OIDC disabled, IdP exposes no end-session endpoint, or the session captured no id_token). Non-browser callers may ignore the URL.",
        tags: ["Auth"],
        security: [],
        responses: {
          200: ok("Session destroyed; optional IdP logout URL returned.", {
            type: "object",
            required: ["endSessionUrl"],
            properties: {
              endSessionUrl: {
                type: "string",
                nullable: true,
                description: "Absolute URL the browser should navigate to in order to terminate the upstream IdP session. Null when no upstream logout is configured or possible.",
              },
            },
          }),
        },
      },
    },

    // ------------------------------------------------------------------
    // OpenAPI contract
    // ------------------------------------------------------------------

    "/openapi.json": {
      get: {
        operationId: "getOpenApiSpec",
        summary: "Retrieve the OpenAPI 3.1 specification for this API",
        tags: ["Meta"],
        security: [],
        responses: {
          200: {
            description: "OpenAPI 3.1 document.",
            content: { "application/json": { schema: { type: "object" } } },
          },
        },
      },
    },
  },
};
