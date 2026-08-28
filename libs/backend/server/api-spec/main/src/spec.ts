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

import { _AuthOpenapiPaths } from "./auth-openapi-paths";
import { _AuthSessionOpenapiPaths } from "./auth-session-openapi-paths";
import { _DomainOpenapiPaths } from "./domain-openapi-paths";
import { _DomainOpenapiSchemas } from "./domain-openapi-schemas";
import { _ErrorEnvelopeSchema, _ValidationIssueSchema } from "./error-schemas";
import { _McpIamOpenapiSchemas } from "./mcp-iam-schemas";
import { _MetaOpenapiPaths } from "./meta-openapi-paths";
import { _ModelDefinitionSchema, _ModelDefinitionWriteSchema } from "./model-definition-schemas";
import { _SelfRunCancellationSchema, _SelfRunStatusSchema } from "./run-schemas";

// ---------------------------------------------------------------------------
// Shared schema references
// ---------------------------------------------------------------------------

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

const AutoRoutingConfigSchema = {
  type: "object" as const,
  required: ["objective", "sessionPin", "explorationRate"],
  description: "Opt-in auto-routing configuration. Auto routing applies ONLY when a skill (or scope default) selects it; the runtime optimizer that consumes it is a later track item (AIR.7).",
  properties: {
    objective: { type: "string", enum: ["cheapest-passing-bar", "best-quality-within-budget", "balanced"], description: "The optimization objective." },
    costQualitySlider: { type: "number", minimum: 0, maximum: 10, description: "Cost↔quality dial for the balanced objective: 0 = cheapest … 10 = best." },
    qualityFloor: { type: "number", description: "Minimum eval score a model must clear; defaults to the skill's own bar when omitted." },
    maxBudgetUsd: { type: "number", minimum: 0, description: "Hard per-decision spend ceiling in USD." },
    allowedModels: { type: "array", items: { type: "string" }, description: "Restrict auto to this subset of publicModelNames; must stay within the key's allowlist." },
    latencyCeilingMs: { type: "number", minimum: 0, description: "Reject/penalize models slower than this many milliseconds." },
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
	additionalProperties: false,
  description: "Upsert body for a scope-level model-routing default. At least one of defaultModel or autoConfig is required.",
  properties: {
    scope: { type: "string", enum: ["global", "clusterTenant"], description: "Defaults to global when omitted." },
    clusterTenant: { type: "string", description: "Required when scope is clusterTenant." },
    defaultModel: { type: "string", description: "Default model publicModelName." },
    autoConfig: { ...AutoRoutingConfigSchema, nullable: true, description: "Default auto-routing config; null clears it." },
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
// Spec document — Composed from domain path fragments
// ---------------------------------------------------------------------------

/**
 * The complete API description: shared schema components, then the domain paths, then the auth
 * and meta routes.
 *
 * This one object has two consumers, which is why edits here are not cosmetic. It is served at
 * `/api/v1/openapi.json` (apps/opencrane/src/app/routes.ts), and it is emitted to a file that
 * generates the typed frontend client — so renaming a component or changing a required field
 * changes compiled frontend code, not just documentation. Regenerate the client in the same
 * change; see the note at the top of this file for the commands.
 *
 * Paths are relative to the `/api/v1` server prefix declared below, and each must match what a
 * router actually mounts.
 *
 * @see {@link _DomainOpenapiPaths} — the per-package path fragments spread into `paths`.
 */
export const spec = {
  openapi: "3.1.0",
  info: {
    title: "OpenCrane Control Plane API",
    version: "1.0.0",
    description: "Multi-tenant AI agent platform management API.\n\n**Authentication**\n\n- *Human operators* — the selected browser authentication mode starts at `GET /auth/login`. Production OIDC completes at `/auth/callback`; disposable Tier 3 development establishes its fixed local identity directly. The session cookie is set server-side.\n- In-cluster workloads use short-lived, audience-bound projected service-account tokens at their dedicated internal trust boundaries.\n- Endpoints tagged *Auth* and *Meta* (`/auth/*`, `/openapi.json`) require no credentials.",
  },
  servers: [
    { url: "/api/v1", description: "Versioned API prefix" },
  ],
  components: {
    schemas: {
      Error: _ErrorEnvelopeSchema,
      ValidationIssue: _ValidationIssueSchema,
      ..._DomainOpenapiSchemas,
      ..._McpIamOpenapiSchemas,
      ClusterTenant: ClusterTenantSchema,
      ClusterTenantWrite: ClusterTenantWriteSchema,
      ClusterTenantUpdate: ClusterTenantUpdateSchema,
      ClusterTenantResourceQuota: ClusterTenantResourceQuotaSchema,
      AuditEntry: AuditEntrySchema,
      ByokProviderKeyStatus: ByokProviderKeyStatusSchema,
      ProviderKeySetRequest: ProviderKeySetRequestSchema,
      ProviderCredential: ProviderCredentialSchema,
      ProviderCredentialWrite: ProviderCredentialWriteSchema,
      ModelDefinition: _ModelDefinitionSchema,
      ModelDefinitionWrite: _ModelDefinitionWriteSchema,
      AutoRoutingConfig: AutoRoutingConfigSchema,
      ModelRoutingDefault: ModelRoutingDefaultSchema,
      ModelRoutingDefaultWrite: ModelRoutingDefaultWriteSchema,
      Budget: BudgetSchema,
      ThirdPartySource: ThirdPartySourceSchema,
      TokenUsage: TokenUsageSchema,
      SelfRunStatus: _SelfRunStatusSchema,
      SelfRunCancellation: _SelfRunCancellationSchema,
      AgentService: {
        type: "object",
        required: ["id", "siloId", "kind", "name", "state", "activeRevisionId", "workloadProfile", "createdAt", "updatedAt"],
        properties: {
          id: { type: "string" },
          siloId: { type: "string" },
          kind: { type: "string", enum: ["managed"] },
          name: { type: "string" },
          state: { type: "string", enum: ["draft", "active", "paused", "retired"] },
          activeRevisionId: { type: "string", nullable: true },
          workloadProfile: { type: "string" },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
        },
      },
      PersonalConfigurationChange: {
        type: "object",
        required: ["changeId", "requestedPatch", "state", "sourceConversationId", "sourceRunId", "proposedAt", "decidedAt", "rejectionReason"],
        properties: {
          changeId: { type: "string" },
          requestedPatch: { oneOf: [{ type: "object", required: ["kind"], additionalProperties: false, properties: { kind: { const: "persona_refresh" } } }, { type: "object", required: ["kind", "modelAlias"], additionalProperties: false, properties: { kind: { const: "model_alias" }, modelAlias: { type: "string", minLength: 1, maxLength: 200, pattern: ".*\\S.*" } } }] },
          state: { type: "string", enum: ["proposed", "accepted", "applied", "rejected", "superseded"] },
          sourceConversationId: { type: "string" },
          sourceRunId: { type: "string" },
          proposedAt: { type: "string", format: "date-time" },
          decidedAt: { type: "string", format: "date-time", nullable: true },
          rejectionReason: { type: "string", nullable: true },
        },
      },
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
    // Compose domain paths in their deliberate JSON-serialization order.
    ..._DomainOpenapiPaths,
    ..._AuthOpenapiPaths,
    ..._AuthSessionOpenapiPaths,
    ..._MetaOpenapiPaths,
  },
};
