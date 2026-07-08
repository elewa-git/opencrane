/**
 * OpenCrane Fleet Manager — OpenAPI 3.1 specification.
 *
 * The fleet plane's HTTP API contract (cluster-tenant lifecycle, billing, org membership,
 * platform DNS, Zitadel admin). The per-silo clustertenant-manager has its OWN spec.
 * Edit this file when you add or change fleet routes, then run:
 *   pnpm --filter @opencrane/fleet-operator emit-openapi
 * and commit the regenerated openapi.json alongside the code change.
 *
 * The CI drift gate runs `emit-openapi` and fails if openapi.json is stale.
 */

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
    brokeringMode: {
      type: "string",
      enum: ["static", "obo"],
      description: "Brokering strategy: 'static' (per-tenant/per-server secret fallback) or 'obo' (per-user RFC 8693 exchange brokered server-side; no static secret).",
    },
    secretRef: {
      type: ["string", "null"],
      description: "Secret reference for 'static' brokering; null for 'obo'.",
    },
  },
};

const McpServerCredentialInputSchema = {
  type: "object" as const,
  required: ["displayName"],
  properties: {
    displayName: { type: "string", description: "Operator-facing label." },
    brokeringMode: {
      type: "string",
      enum: ["static", "obo"],
      description: "Defaults to 'static'. 'static' requires secretRef; 'obo' must omit it.",
    },
    secretRef: { type: "string", description: "Required for 'static' brokering; omit for 'obo'." },
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
    seatCap: { type: "integer", minimum: 0, description: "Maximum org memberships (seats); absent when uncapped. New members are refused with 409 SEAT_CAP_EXCEEDED once the org is at its cap." },
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
    seatCap: { type: ["integer", "null"], minimum: 0, description: "Maximum org memberships (seats). Omit or null for uncapped. The fleet refuses a new member once the org is at its cap." },
  },
};

const BillingAccountSchema = {
  type: "object" as const,
  required: ["id", "subject", "createdAt", "updatedAt"],
  properties: {
    id: { type: "string", description: "Surrogate identifier." },
    subject: { type: "string", description: "IdP-verified subject (OIDC sub) that owns this billing account." },
    email: { type: ["string", "null"], description: "The caller's verified email at create time (for human reconciliation; not the key)." },
    displayName: { type: ["string", "null"], description: "Optional human-readable billing name (company / individual)." },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
  },
};

const BillingAccountWriteSchema = {
  type: "object" as const,
  description: "Create payload for the caller's own billing account. The subject and email come from the session (never the body); only an optional displayName is accepted.",
  properties: {
    displayName: { type: "string", description: "Optional human-readable billing name (company / individual)." },
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
    seatCap: { type: ["integer", "null"], minimum: 0, description: "New seat cap; null clears it (uncapped). The fleet refuses a new member once the org is at its cap." },
  },
};

const OrgMemberSchema = {
  type: "object" as const,
  required: ["subject", "role"],
  description: "A single organisation membership row — the fleet's authoritative membership registry (the org-admin gate reads it; the silo mirrors it). Writes are Zitadel-seated transactionally: an upsert grants the member's project role and a removal revokes their org membership at the IdP.",
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

const SkillBundleSchema = {
  type: "object" as const,
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    description: { type: "string" },
    version: { type: "string" },
    digest: { type: "string" },
    scope: { type: "string", enum: ["org", "team", "project", "personal"] },
    status: { type: "string", enum: ["draft", "published", "deprecated"] },
    tags: { type: "array", items: { type: "string" } },
    sourceName: { type: "string" },
    publishedAt: { type: "string", format: "date-time" },
    grants: { type: "array", items: { type: "object" } },
    promotions: { type: "array", items: { type: "object" } },
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

const AccessTokenSchema = {
  type: "object" as const,
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    owner: { type: "string" },
    createdAt: { type: "string", format: "date-time" },
    expiresAt: { type: "string", format: "date-time" },
    lastUsedAt: { type: "string", format: "date-time" },
  },
};

const ProviderKeySchema = {
  type: "object" as const,
  properties: {
    provider: { type: "string" },
    configured: { type: "boolean" },
    updatedAt: { type: "string", format: "date-time" },
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

const SkillModelPostureSchema = {
  type: "object" as const,
  required: ["name", "scope", "team", "path"],
  properties: {
    name: { type: "string", description: "Skill name (part of the compound key)." },
    scope: { type: "string", description: "Skill scope, e.g. org/team/personal (part of the compound key)." },
    team: { type: "string", description: "Owning team for team-scoped skills; empty string when not team-scoped (part of the compound key)." },
    path: { type: "string", description: "Workspace-relative path the skill is delivered to." },
    modelMode: { type: "string", enum: ["pinned", "auto"], nullable: true, description: "pinned (use pinnedModel), auto (route within autoConfig), or null (inherit the scope default)." },
    pinnedModel: { type: "string", nullable: true, description: "The pinned model's publicModelName, when modelMode is pinned." },
    autoConfig: { ...AutoRoutingConfigSchema, nullable: true, description: "The skill's auto-routing config, when modelMode is auto." },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
  },
};

const SkillModelPostureWriteSchema = {
  type: "object" as const,
  required: ["modelMode"],
  description: "Set a skill's model posture. pinned requires pinnedModel; auto validates autoConfig; null clears the posture (inherit the scope default).",
  properties: {
    modelMode: { type: "string", enum: ["pinned", "auto"], nullable: true, description: "pinned, auto, or null to clear the posture." },
    pinnedModel: { type: "string", nullable: true, description: "Required when modelMode is pinned." },
    autoConfig: { ...AutoRoutingConfigSchema, nullable: true, description: "Provided when modelMode is auto." },
  },
};

const RoutingEvalCaseSchema = {
  type: "object" as const,
  required: ["id", "skillName", "skillScope", "skillTeam", "qualityBar"],
  properties: {
    id: { type: "string", description: "Stable identifier." },
    skillName: { type: "string", description: "Owning skill name." },
    skillScope: { type: "string", description: "Owning skill scope." },
    skillTeam: { type: "string", description: "Owning skill team (empty for org/global)." },
    input: { description: "The prompt/inputs for this case." },
    expected: { nullable: true, description: "Optional golden answer or grader rubric." },
    qualityBar: { type: "number", minimum: 0, maximum: 1, description: "Minimum judge score (0..1) a model must clear on this case." },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
  },
};

const RoutingEvalCaseWriteSchema = {
  type: "object" as const,
  required: ["skillName", "skillScope", "input"],
  description: "Create/update body for a routing eval case (AIR.6).",
  properties: {
    skillName: { type: "string", description: "Owning skill name." },
    skillScope: { type: "string", description: "Owning skill scope." },
    skillTeam: { type: "string", description: "Owning skill team (defaults to empty)." },
    input: { description: "The prompt/inputs for this case." },
    expected: { nullable: true, description: "Optional golden answer or grader rubric." },
    qualityBar: { type: "number", minimum: 0, maximum: 1, description: "Minimum judge score (0..1); defaults to 0.8." },
  },
};

const RoutingMeasurementSchema = {
  type: "object" as const,
  required: ["id", "skillName", "skillScope", "skillTeam", "sampledCalls", "atBarCheapFraction", "projectedSavingsPct", "ciLowPct", "ciHighPct", "overheadPct"],
  properties: {
    id: { type: "string", description: "Stable identifier." },
    skillName: { type: "string", description: "Owning skill name." },
    skillScope: { type: "string", description: "Owning skill scope." },
    skillTeam: { type: "string", description: "Owning skill team." },
    candidateModel: { type: "string", nullable: true, description: "The cheaper candidate model evaluated against the current default." },
    sampledCalls: { type: "integer", description: "Number of logged calls sampled + shadow-graded." },
    atBarCheapFraction: { type: "number", description: "Fraction of sampled traffic the candidate served at-or-above the skill's bar." },
    projectedSavingsPct: { type: "number", description: "Point estimate of % spend saved at equal quality." },
    ciLowPct: { type: "number", description: "Lower bound of the bootstrap 95% CI on projected savings." },
    ciHighPct: { type: "number", description: "Upper bound of the bootstrap 95% CI on projected savings." },
    overheadPct: { type: "number", description: "Token overhead of running the measurement, as % of the skill's serve spend." },
    skillContentHash: { type: "string", nullable: true, description: "Skill content version coordinate: the Skill.contentHash at run time (best-effort; null if unresolved)." },
    skillDigest: { type: "string", nullable: true, description: "Skill content version coordinate: the live published SkillBundle.digest at run time (best-effort; null when no published bundle)." },
    candidateModelId: { type: "string", nullable: true, description: "Model deployment coordinate: the candidate's stable litellmModelId (best-effort; null if unresolved)." },
    candidateUpstreamModel: { type: "string", nullable: true, description: "Model deployment coordinate: the candidate's upstreamModel (best-effort; null if unresolved)." },
    runAt: { type: "string", format: "date-time" },
  },
};

const RoutingProposalSchema = {
  type: "object" as const,
  required: ["id", "skillName", "skillScope", "skillTeam", "proposedModel", "projectedSavingsPct", "ciLowPct", "ciHighPct", "status"],
  properties: {
    id: { type: "string", description: "Stable identifier." },
    skillName: { type: "string", description: "Owning skill name." },
    skillScope: { type: "string", description: "Owning skill scope." },
    skillTeam: { type: "string", description: "Owning skill team." },
    fromModel: { type: "string", nullable: true, description: "The model the skill resolves to today (null when unset)." },
    proposedModel: { type: "string", description: "The cheaper model the loop proposes switching to." },
    projectedSavingsPct: { type: "number", description: "Point estimate of % spend saved at equal quality." },
    ciLowPct: { type: "number", description: "Lower bound of the bootstrap 95% CI (must exclude zero to propose)." },
    ciHighPct: { type: "number", description: "Upper bound of the bootstrap 95% CI." },
    skillContentHash: { type: "string", nullable: true, description: "Skill content version coordinate: the Skill.contentHash at proposal time (best-effort; null if unresolved)." },
    skillDigest: { type: "string", nullable: true, description: "Skill content version coordinate: the live published SkillBundle.digest at proposal time (best-effort; null when none)." },
    proposedModelId: { type: "string", nullable: true, description: "Model deployment coordinate: the proposed model's stable litellmModelId (best-effort; null if unresolved)." },
    measurementId: { type: "string", nullable: true, description: "The measurement that produced this proposal." },
    status: { type: "string", enum: ["pending", "approved", "rejected", "applied"], description: "Lifecycle status." },
    decidedBy: { type: "string", nullable: true, description: "Principal who approved/rejected, when decided." },
    decidedAt: { type: "string", format: "date-time", nullable: true },
    createdAt: { type: "string", format: "date-time" },
  },
};

const SavingsRecommendationSchema = {
  type: "object" as const,
  required: ["skillName", "skillScope", "skillTeam", "projectedSavingsPct", "ciLowPct", "ciHighPct", "hasOpenProposal", "measurementId", "runAt"],
  properties: {
    skillName: { type: "string", description: "Owning skill name." },
    skillScope: { type: "string", description: "Owning skill scope." },
    skillTeam: { type: "string", description: "Owning skill team (empty for org/global)." },
    modelMode: { type: "string", enum: ["pinned", "auto"], nullable: true, description: "The skill's posture: pinned, auto, or null (inherits the scope default) — lets the UI flag a fixed-model advisory distinctly." },
    currentModel: { type: "string", nullable: true, description: "The model the skill resolves to today — proposal fromModel, else the skill's pin, else null." },
    recommendedModel: { type: "string", nullable: true, description: "The cheaper model recommended — proposal proposedModel, else the measurement candidate, else null." },
    recommendedModelId: { type: "string", nullable: true, description: "Stable deployment id of the recommended model — proposal proposedModelId, else the measurement's candidateModelId, else null." },
    skillContentHash: { type: "string", nullable: true, description: "Skill content version coordinate the evidence was gathered at — lets the console flag stale evidence; null if unresolved." },
    skillDigest: { type: "string", nullable: true, description: "Live published SkillBundle.digest the evidence was gathered at; null when none." },
    projectedSavingsPct: { type: "number", description: "Point estimate of % spend saved at equal quality (from the latest measurement)." },
    ciLowPct: { type: "number", description: "Lower bound of the bootstrap 95% CI on projected savings." },
    ciHighPct: { type: "number", description: "Upper bound of the bootstrap 95% CI on projected savings." },
    hasOpenProposal: { type: "boolean", description: "True when an open Pending proposal exists for this skill." },
    proposalId: { type: "string", nullable: true, description: "Id of the open Pending proposal, when one exists; null otherwise." },
    measurementId: { type: "string", description: "Id of the latest measurement this recommendation is derived from." },
    runAt: { type: "string", format: "date-time", description: "When the latest measurement ran (ISO-8601)." },
  },
};

const DeviceGrantSchema = {
  type: "object" as const,
  required: ["deviceCode", "userCode", "verificationUri", "expiresIn", "interval"],
  properties: {
    deviceCode: { type: "string", description: "Secret code used by the CLI to poll for the token." },
    userCode: { type: "string", description: "Short code (XXXX-XXXX) the operator sees." },
    verificationUri: { type: "string", description: "Relative URL the operator should open in a browser." },
    expiresIn: { type: "integer", description: "Seconds until the grant expires (300)." },
    interval: { type: "integer", description: "Minimum polling interval in seconds (5)." },
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
    skills: { type: "object" },
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
// Spec document
// ---------------------------------------------------------------------------

export const spec = {
  openapi: "3.1.0",
  info: {
    title: "OpenCrane Fleet Manager API",
    version: "1.0.0",
    description: "Cluster-wide fleet / super-admin API: ClusterTenant lifecycle, billing, org membership, platform DNS, and Zitadel administration.\n\n**Authentication**\n\n- *Human operators* — OIDC browser flow via `GET /auth/login` → `/auth/callback`. Session cookie is set server-side.\n- *CLI operators* — Device authorization grant via `POST /auth/device`. The CLI opens the returned `verificationUri` in the operator's browser, polls `GET /auth/device/token`, and persists the issued token in `~/.config/opencrane/credentials.json`.\n- *Automation / CI* — Bearer token via the `OPENCRANE_TOKEN` environment variable, validated against the `OPENCRANE_API_TOKEN` server-side env var.\n- Endpoints tagged *Auth* and *Meta* (`/auth/*`, `/openapi.json`) require no credentials.",
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
      BillingAccount: BillingAccountSchema,
      BillingAccountWrite: BillingAccountWriteSchema,
      Group: GroupSchema,
      Share: {
        type: "object",
        description: "An inter-user share: an Allow grant the caller created on a recipient for an entitlement they hold (S4).",
        properties: {
          id: { type: "string" },
          payloadType: { type: "string", enum: ["mcp-server", "skill-bundle"], description: "The entitlement family shared." },
          payloadId: { type: "string", description: "Id of the shared MCP server or skill bundle." },
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
      SkillBundle: SkillBundleSchema,
      AuditEntry: AuditEntrySchema,
      AccessToken: AccessTokenSchema,
      ProviderKey: ProviderKeySchema,
      ProviderCredential: ProviderCredentialSchema,
      ProviderCredentialWrite: ProviderCredentialWriteSchema,
      ModelDefinition: ModelDefinitionSchema,
      ModelDefinitionWrite: ModelDefinitionWriteSchema,
      AutoRoutingConfig: AutoRoutingConfigSchema,
      ModelRoutingDefault: ModelRoutingDefaultSchema,
      ModelRoutingDefaultWrite: ModelRoutingDefaultWriteSchema,
      SkillModelPosture: SkillModelPostureSchema,
      SkillModelPostureWrite: SkillModelPostureWriteSchema,
      RoutingEvalCase: RoutingEvalCaseSchema,
      RoutingEvalCaseWrite: RoutingEvalCaseWriteSchema,
      RoutingMeasurement: RoutingMeasurementSchema,
      RoutingProposal: RoutingProposalSchema,
      SavingsRecommendation: SavingsRecommendationSchema,
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
      ScopeSelector: {
        type: "object",
        required: ["scope", "payloadId"],
        properties: {
          scope: { type: "string", enum: ["org", "department", "project", "personal"] },
          payloadId: { type: "string" },
        },
      },
      SessionScope: {
        type: "object",
        properties: {
          sessionKey: { type: "string" },
          principal: { type: "string" },
          scopes: { type: "array", items: { $ref: "#/components/schemas/ScopeSelector" } },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
        },
      },
      DatasetMembership: DatasetMembershipSchema,
      EffectiveContract: EffectiveContractSchema,
      ProjectionDrift: ProjectionDriftSchema,
      Budget: BudgetSchema,
      ThirdPartySource: ThirdPartySourceSchema,
      TokenUsage: TokenUsageSchema,
      DeviceGrant: DeviceGrantSchema,
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
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        description: "Static bearer token. Pass as Authorization: Bearer <token>.",
      },
    },
  },
  security: [{ bearerAuth: [] }],
  paths: {

    // ------------------------------------------------------------------
    // Auth — platform-operator OIDC session (browser login flow only;
    // no per-user pod brokering / device grant — those are silo-plane).
    // ------------------------------------------------------------------

    "/auth/me": {
      get: {
        operationId: "getAuthStatus",
        summary: "Return current auth mode and authenticated user identity (if any)",
        description: "No authentication required. Returns 200 with the current session or an anonymous identity when no session is established. The fleet plane is cluster-wide, so (unlike the silo control plane) the user carries no per-silo `clusterTenant`.",
        tags: ["Auth"],
        security: [],
        responses: {
          200: ok("Auth status.", {
            type: "object",
            required: ["mode", "authenticated"],
            properties: {
              mode: { type: "string", enum: ["development", "oidc", "token"], description: "Active authentication mode for this instance." },
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
                    description: "True iff the caller's groups intersect OPENCRANE_PLATFORM_OPERATOR_GROUPS. Empty/unset config ⇒ false (fail-closed). Introspection only — the API stays the enforcement point and the frontend uses this only to hide UI.",
                  },
                  isOrgAdmin: {
                    type: "boolean",
                    description: "True iff the caller is an organisation admin (groups intersect OPENCRANE_ORG_ADMIN_GROUPS, or the caller is a platform operator). Empty/unset config ⇒ false (fail-closed). Introspection only — the API stays the enforcement point.",
                  },
                  ownedOrgs: {
                    type: "array",
                    description: "Organisations the caller owns or administers, derived fresh from their OrgMembership rows (owner/admin only; members excluded). Empty when the caller administers no org. Introspection only — never taken from request input.",
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

    "/auth/login": {
      get: {
        operationId: "startOidcLogin",
        summary: "Redirect the browser to the configured OIDC identity provider to start login",
        description: "Browser redirect — not intended for programmatic use. Returns 503 when OIDC is not configured.",
        tags: ["Auth"],
        security: [],
        parameters: [
          { name: "returnTo", in: "query", schema: { type: "string" }, description: "Path to redirect back to after a successful login." },
          { name: "prompt", in: "query", schema: { type: "string" }, description: "OIDC prompt value. Pass \"create\" to show the Zitadel registration form instead of login." },
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
    // Admin — Zitadel SA key rotation (superadmin / platform-operator only)
    // ------------------------------------------------------------------

    "/admin/zitadel/sa-key:rotate": {
      post: {
        operationId: "rotateZitadelSaKey",
        summary: "Rotate the platform Zitadel service-account key (validate-then-swap; superadmin only)",
        description: "Validates the candidate key against the live instance (jwt-bearer exchange + a non-destructive instance IAM_OWNER probe) and swaps the live key ONLY when both pass; on any validation failure the old key stays active (422). Platform-operator gated.",
        tags: ["Admin"],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/ZitadelKeyRotateRequest" } } },
        },
        responses: {
          200: ok("The candidate was validated, persisted, and made live.", { $ref: "#/components/schemas/ZitadelKeyRotateResult" }),
          400: badRequest("The request body did not include a usable `serviceAccountKey`."),
          403: forbidden("Caller is not a platform operator."),
          409: conflict("Key-Secret persistence is not configured (ZITADEL_MGMT_SECRET_NAME unset); rotation refused."),
          422: unprocessable("The candidate key failed validation (token exchange or instance IAM_OWNER scope); no change was made."),
        },
      },
    },

    "/admin/zitadel/reconcile": {
      post: {
        operationId: "reconcileZitadelOrgs",
        summary: "Reconcile/backfill incomplete Zitadel orgs across the fleet (idempotent; superadmin only)",
        description: "For every ClusterTenant whose Zitadel ids are incomplete (missing orgId, clientId, appId, or projectId), re-runs provisionOrg (master subject = the org's Owner membership) and persists the ids transactionally. Idempotent: a fully-provisioned org is skipped (no Zitadel call); an org with no Owner is skipped (no-owner); a per-org provision failure is collected (failed) and never aborts the run. Optionally pass { name } to reconcile a single org. Platform-operator gated.",
        tags: ["Admin"],
        requestBody: {
          required: false,
          content: { "application/json": { schema: { $ref: "#/components/schemas/ZitadelReconcileRequest" } } },
        },
        responses: {
          200: ok("The reconcile run completed; summary of reconciled / skipped / failed orgs.", { $ref: "#/components/schemas/ZitadelReconcileSummary" }),
          403: forbidden("Caller is not a platform operator."),
          404: notFound("The named cluster tenant does not exist (single-org reconcile)."),
        },
      },
    },

    // ------------------------------------------------------------------
    // Platform DNS / TLS issuance (CONN.8a)
    // ------------------------------------------------------------------

    "/platform/dns": {
      get: {
        operationId: "getPlatformDns",
        summary: "Show the configured platform DNS-01 issuer (ClusterIssuer or namespaced Issuer)",
        tags: ["Platform DNS"],
        parameters: [{ name: "issuerName", in: "query", required: false, schema: { type: "string" } }],
        responses: {
          200: ok("Current issuer status.", {
            type: "object",
            properties: {
              configured: { type: "boolean" },
              issuerName: { type: "string" },
              issuerKind: { type: "string", enum: ["ClusterIssuer", "Issuer"] },
              issuerNamespace: { type: "string", nullable: true },
              provider: { type: "string", nullable: true },
              email: { type: "string", nullable: true },
              server: { type: "string", nullable: true },
            },
          }),
        },
      },
      put: {
        operationId: "setPlatformDns",
        summary: "Configure the platform DNS-01 issuer for wildcard TLS (ClusterIssuer or namespaced Issuer)",
        tags: ["Platform DNS"],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["provider", "zone", "email"],
                properties: {
                  provider: { type: "string" },
                  zone: { type: "string" },
                  email: { type: "string" },
                  server: { type: "string" },
                  issuerName: { type: "string" },
                  apiToken: { type: "string" },
                  solverConfig: { type: "object", additionalProperties: true },
                },
              },
            },
          },
        },
        responses: {
          200: ok("Issuer configured.", {
            type: "object",
            properties: {
              status: { type: "string" },
              issuerName: { type: "string" },
              issuerKind: { type: "string", enum: ["ClusterIssuer", "Issuer"] },
              issuerNamespace: { type: "string", nullable: true },
              provider: { type: "string" },
              zone: { type: "string" },
              secretName: { type: "string", nullable: true },
            },
          }),
        },
      },
    },
    // ------------------------------------------------------------------
    // Cluster Tenants (CT.2) — first-class customer / isolation unit
    // ------------------------------------------------------------------

    "/cluster-tenants": {
      get: {
        operationId: "listClusterTenants",
        summary: "List all cluster tenants (fleet view — platform-operator only)",
        description: "Fleet-wide list. Restricted to platform operators; a per-org owner/admin reads only their own org via GET /cluster-tenants/{name}.",
        tags: ["Cluster Tenants"],
        responses: {
          200: ok("Cluster tenant list.", { type: "array", items: { $ref: "#/components/schemas/ClusterTenant" } }),
          401: unauthorized("No authenticated session (real-auth deployments)."),
          403: forbidden("Caller is not a platform operator."),
        },
      },
      post: {
        operationId: "createClusterTenant",
        summary: "Create a cluster tenant (organisation) and become its owner",
        description: "Any authenticated user WITH an existing billing account may create an organisation; the caller is recorded as the org's single owner transactionally. Requires a billing account first (POST /billing-accounts), NOT pre-existing org-admin — a user becomes an org admin by creating their first org. Rejects an isolation tier no provisioner can serve.",
        tags: ["Cluster Tenants"],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/ClusterTenantWrite" } } },
        },
        responses: {
          201: created("Cluster tenant created; caller recorded as owner.", { $ref: "#/components/schemas/ClusterTenant" }),
          400: badRequest("Request body failed validation."),
          401: unauthorized("No authenticated session (real-auth deployments)."),
          403: forbidden("Caller has no billing account (code BILLING_ACCOUNT_REQUIRED)."),
          409: conflict("A workspace with this name already exists (code CONFLICT)."),
          422: unprocessable("Requested isolation tier is not served by any registered provisioner (code TIER_UNAVAILABLE)."),
        },
      },
    },

    "/cluster-tenants/{name}": {
      get: {
        operationId: "getClusterTenant",
        summary: "Get a single cluster tenant by name (operator OR owner/admin of that org)",
        tags: ["Cluster Tenants"],
        parameters: [{ name: "name", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          200: ok("Cluster tenant detail.", { $ref: "#/components/schemas/ClusterTenant" }),
          401: unauthorized("No authenticated session (real-auth deployments)."),
          403: forbidden("Caller is neither a platform operator nor an owner/admin of this org."),
          404: notFound("Cluster tenant not found."),
        },
      },
      put: {
        operationId: "updateClusterTenant",
        summary: "Update a cluster tenant (operator OR owner/admin of that org); re-gates the isolation tier when it changes",
        tags: ["Cluster Tenants"],
        parameters: [{ name: "name", in: "path", required: true, schema: { type: "string" } }],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/ClusterTenantUpdate" } } },
        },
        responses: {
          200: ok("Cluster tenant updated.", { $ref: "#/components/schemas/ClusterTenant" }),
          400: badRequest("Request body failed validation."),
          401: unauthorized("No authenticated session (real-auth deployments)."),
          403: forbidden("Caller is neither a platform operator nor an owner/admin of this org."),
          404: notFound("Cluster tenant not found."),
          422: unprocessable("Requested isolation tier is not served by any registered provisioner (code TIER_UNAVAILABLE)."),
        },
      },
      delete: {
        operationId: "deleteClusterTenant",
        summary: "Delete a cluster tenant (operator OR owner/admin of that org)",
        tags: ["Cluster Tenants"],
        parameters: [{ name: "name", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          200: ok("Cluster tenant deleted.", { type: "object", properties: { name: { type: "string" }, status: { type: "string" } } }),
          401: unauthorized("No authenticated session (real-auth deployments)."),
          403: forbidden("Caller is neither a platform operator nor an owner/admin of this org."),
          404: notFound("Cluster tenant not found."),
        },
      },
    },

    "/cluster-tenants/{name}/status": {
      get: {
        operationId: "getClusterTenantStatus",
        summary: "Get the observed status of a cluster tenant (operator OR owner/admin of that org)",
        tags: ["Cluster Tenants"],
        parameters: [{ name: "name", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          200: ok("Cluster tenant status.", {
            type: "object",
            properties: {
              phase: { type: "string", enum: ["pending", "provisioning", "ready", "failed"] },
              message: { type: "string" },
              boundNamespace: { type: "string" },
              provisioner: { type: "string" },
            },
          }),
          401: unauthorized("No authenticated session (real-auth deployments)."),
          403: forbidden("Caller is neither a platform operator nor an owner/admin of this org."),
          404: notFound("Cluster tenant not found."),
        },
      },
    },

    "/cluster-tenants/{name}/refresh": {
      post: {
        operationId: "refreshClusterTenant",
        summary: "Refresh a cluster tenant's status and reconcile its owner workspace tenant",
        description: "Re-reads the operator's observed phase from the CR (mirroring it to the DB), then — when the org is fully `ready` but has no workspace Tenant projected — seeds the owner's `<org>-default` Tenant via the same dual-write (CRD + DB row) the create path uses. Idempotent: a ready org that already has its tenant just returns the current status.",
        tags: ["Cluster Tenants"],
        parameters: [{ name: "name", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          200: ok("Refreshed status, plus the default-tenant reconcile outcome (null when the org is not yet ready).", {
            type: "object",
            properties: {
              status: {
                type: "object",
                properties: {
                  phase: { type: "string", enum: ["pending", "provisioning", "ready", "failed"] },
                  message: { type: "string" },
                  boundNamespace: { type: "string" },
                  provisioner: { type: "string" },
                },
              },
              defaultTenant: {
                type: "object",
                nullable: true,
                properties: {
                  tenantName: { type: "string" },
                  created: { type: "boolean" },
                  skippedReason: { type: "string" },
                },
              },
            },
          }),
          401: unauthorized("No authenticated session (real-auth deployments)."),
          403: forbidden("Caller is neither a platform operator nor an owner/admin of this org."),
          404: notFound("Cluster tenant not found."),
        },
      },
    },

    "/cluster-tenants/{name}/members": {
      get: {
        operationId: "listClusterTenantMembers",
        summary: "List an organisation's members (operator OR owner/admin of that org)",
        description: "Lists the org's membership rows (subject + role) from the fleet's authoritative membership registry (writes are Zitadel-seated; the silo read-model mirrors this set).",
        tags: ["Cluster Tenants"],
        parameters: [{ name: "name", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          200: ok("Organisation membership list.", { type: "array", items: { $ref: "#/components/schemas/OrgMember" } }),
          401: unauthorized("No authenticated session (real-auth deployments)."),
          403: forbidden("Caller is neither a platform operator nor an owner/admin of this org."),
          404: notFound("Cluster tenant not found."),
        },
      },
      post: {
        operationId: "addClusterTenantMember",
        summary: "Add or update an organisation member (operator OR owner/admin of that org)",
        description: "Upserts a membership on the unique [org, subject]: adds a new member or changes an existing member's role. Last-Owner guardrail: demoting the org's sole Owner to a lesser role is rejected (409 LAST_OWNER).",
        tags: ["Cluster Tenants"],
        parameters: [{ name: "name", in: "path", required: true, schema: { type: "string" } }],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/OrgMemberWrite" } } },
        },
        responses: {
          200: ok("Member added or updated.", { $ref: "#/components/schemas/OrgMember" }),
          400: badRequest("Request body failed validation (subject required; role must be Owner|Admin|Member)."),
          401: unauthorized("No authenticated session (real-auth deployments)."),
          403: forbidden("Caller is neither a platform operator nor an owner/admin of this org."),
          404: notFound("Cluster tenant not found."),
          409: conflict("The change would demote the organisation's last Owner (code LAST_OWNER)."),
        },
      },
    },

    "/cluster-tenants/{name}/members/{subject}": {
      delete: {
        operationId: "removeClusterTenantMember",
        summary: "Remove an organisation member (operator OR owner/admin of that org)",
        description: "Removes a membership row. Last-Owner guardrail: removing the org's sole Owner is rejected (409 LAST_OWNER).",
        tags: ["Cluster Tenants"],
        parameters: [
          { name: "name", in: "path", required: true, schema: { type: "string" } },
          { name: "subject", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: {
          200: ok("Member removed.", { type: "object", properties: { subject: { type: "string" }, status: { type: "string" } } }),
          401: unauthorized("No authenticated session (real-auth deployments)."),
          403: forbidden("Caller is neither a platform operator nor an owner/admin of this org."),
          404: notFound("Cluster tenant or membership not found."),
          409: conflict("Removing this member would remove the organisation's last Owner (code LAST_OWNER)."),
        },
      },
    },

    // ------------------------------------------------------------------
    // Billing accounts — the prerequisite for creating an organisation
    // ------------------------------------------------------------------

    "/billing-accounts": {
      post: {
        operationId: "createBillingAccount",
        summary: "Create the caller's own billing account (idempotent per subject)",
        description: "Any authenticated user creates their OWN billing account, keyed to their IdP-verified subject (never request input). Idempotent: a repeat call returns the existing account (200) instead of failing. Having a billing account is the gate for creating an organisation (POST /cluster-tenants).",
        tags: ["Billing"],
        requestBody: {
          required: false,
          content: { "application/json": { schema: { $ref: "#/components/schemas/BillingAccountWrite" } } },
        },
        responses: {
          201: created("Billing account created.", { $ref: "#/components/schemas/BillingAccount" }),
          200: ok("Billing account already existed (idempotent).", { $ref: "#/components/schemas/BillingAccount" }),
          401: unauthorized("No authenticated session (real-auth deployments)."),
        },
      },
    },

    "/billing-accounts/me": {
      get: {
        operationId: "getMyBillingAccount",
        summary: "Return the caller's own billing account",
        tags: ["Billing"],
        responses: {
          200: ok("Billing account detail.", { $ref: "#/components/schemas/BillingAccount" }),
          401: unauthorized("No authenticated session (real-auth deployments)."),
          404: notFound("Caller has no billing account (code BILLING_ACCOUNT_NOT_FOUND)."),
        },
      },
    },
  },
};
