/**
 * Shared types for the model-routing registry (Track AIR): provider credentials and
 * model definitions. Provider keys are owned at installation (Global) or ClusterTenant
 * scope, and OpenCrane stores only a reference to the
 * External-Secrets-synced k8s Secret, never the raw key.
 */

/**
 * Scope at which a provider credential or model definition is owned.
 * Mirrors the Prisma `ModelRoutingScope` enum.
 */
export const ModelRoutingScope = {
  Global: "global",
  ClusterTenant: "clusterTenant",
} as const;

/** Union of the {@link ModelRoutingScope} values. */
export type ModelRoutingScope = (typeof ModelRoutingScope)[keyof typeof ModelRoutingScope];

/** A provider API credential reference (the raw key lives in a k8s Secret, not here). */
export interface ProviderCredential
{
  /** Stable identifier. */
  id: string;
  /** Whether the credential is platform-wide or owned by one ClusterTenant. */
  scope: ModelRoutingScope;
  /** Owning ClusterTenant when `scope` is `clusterTenant`; null for Global. */
  clusterTenant: string | null;
  /** Free-text provider key (e.g. `openai`, `anthropic`, `bedrock`). */
  provider: string;
  /** Name of the External-Secrets-synced k8s Secret carrying the provider key. */
  secretRef: string;
  /** LiteLLM `/credentials` name when registered for the dynamic path; null for the env baseline. */
  litellmCredentialName: string | null;
  /** Creation timestamp (ISO-8601). */
  createdAt: string;
  /** Last-update timestamp (ISO-8601). */
  updatedAt: string;
}

/** Create/update body for a {@link ProviderCredential}. */
export interface ProviderCredentialWrite
{
  /** Defaults to `global` when omitted. */
  scope?: ModelRoutingScope;
  /** Required when `scope` is `clusterTenant`. */
  clusterTenant?: string;
  /** Free-text provider key. */
  provider: string;
  /** Name of the External-Secrets-synced k8s Secret carrying the provider key. */
  secretRef: string;
  /** Optional LiteLLM `/credentials` name for the dynamic no-restart path. */
  litellmCredentialName?: string;
}

/** A routable model registered in LiteLLM (BYOM). */
export interface ModelDefinition
{
  /** Stable identifier. */
  id: string;
  /** Whether the model is platform-wide or owned by one ClusterTenant. */
  scope: ModelRoutingScope;
  /** Owning ClusterTenant when `scope` is `clusterTenant`; null for Global. */
  clusterTenant: string | null;
  /** The routable public slug callers request, e.g. `openai/gpt-4o`. */
  publicModelName: string;
  /** Deployment id returned by LiteLLM `/model/new`. */
  litellmModelId: string;
  /** Upstream model the deployment targets, e.g. `openai/gpt-4o`. */
  upstreamModel: string;
  /** Optional non-default API base for self-hosted / proxied endpoints. */
  apiBase: string | null;
  /** Whether this is the default model at its scope. */
  isDefault: boolean;
  /** The provider credential backing this model, when set. */
  providerCredentialId: string | null;
  /** Creation timestamp (ISO-8601). */
  createdAt: string;
  /** Last-update timestamp (ISO-8601). */
  updatedAt: string;
}

/**
 * Providers a BYOK upstream key may be set for. Unlike {@link ProviderCredential} (a reference to
 * an externally-synced Secret), a BYOK key is set with its RAW value over HTTPS, persisted to a
 * k8s Secret, and registered with LiteLLM's `/credentials` dynamic path. Add providers here as the
 * runtime gains routing support for them.
 */
export const ByokProvider = {
  OpenAI: "openai",
  Anthropic: "anthropic",
  Gemini: "gemini",
  Mistral: "mistral",
  Deepseek: "deepseek",
  Glm: "glm",
} as const;

/** Union of the {@link ByokProvider} values. */
export type ByokProvider = (typeof ByokProvider)[keyof typeof ByokProvider];

/**
 * Set/refresh body for a BYOK provider key. Carries the RAW upstream key — accepted only over
 * HTTPS, written straight to a k8s Secret and LiteLLM, and NEVER echoed back by any read endpoint.
 */
export interface ProviderKeySetRequest
{
  /** The raw upstream provider API key (e.g. `sk-...`). */
  apiKey: string;
}

/** Read-side status of a BYOK provider key. Carries no key material — presence and timestamps only. */
export interface ProviderKeyStatus
{
  /** The provider this status describes. */
  provider: ByokProvider;
  /** Whether a key is currently set for this provider in this silo. */
  configured: boolean;
  /** Whether the key was accepted by LiteLLM's `/credentials` dynamic path (false ⇒ Secret-only). */
  litellmRegistered: boolean;
  /** When the key was last set (ISO-8601); null when not configured. */
  updatedAt: string | null;
}

/** Create/update body for a {@link ModelDefinition}. */
export interface ModelDefinitionWrite
{
  /** Defaults to `global` when omitted. */
  scope?: ModelRoutingScope;
  /** Required when `scope` is `clusterTenant`. */
  clusterTenant?: string;
  /** The routable public slug, e.g. `openai/gpt-4o`. */
  publicModelName: string;
  /** Upstream model the deployment targets. */
  upstreamModel: string;
  /** Optional non-default API base. */
  apiBase?: string;
  /** Whether this is the default model at its scope. */
  isDefault?: boolean;
  /** Provider credential backing this model. */
  providerCredentialId?: string;
}

/**
 * How a skill chooses its model.
 *
 * `pinned` always uses the skill's own `pinnedModel`. `auto` picks within the skill's
 * {@link AutoRoutingConfig}. Absent — not one of these two values — means the skill inherits
 * {@link ModelRoutingDefault} for its scope, so a caller must handle absence as a third case
 * rather than defaulting it locally.
 *
 * Mirrors the Prisma `SkillModelMode` enum; the two must stay equal.
 */
export const SkillModelMode = {
  Pinned: "pinned",
  Auto: "auto",
} as const;

/** Union of the {@link SkillModelMode} values. */
export type SkillModelMode = (typeof SkillModelMode)[keyof typeof SkillModelMode];

/** What `auto` routing optimises for: cheapest model that clears the quality bar, best model within budget, or a balance set by `costQualitySlider`. */
export const AutoRoutingObjective = {
  CheapestPassingBar: "cheapest-passing-bar",
  BestQualityWithinBudget: "best-quality-within-budget",
  Balanced: "balanced",
} as const;

/** Union of the {@link AutoRoutingObjective} values. */
export type AutoRoutingObjective = (typeof AutoRoutingObjective)[keyof typeof AutoRoutingObjective];

/**
 * Settings for "auto" model routing.
 *
 * This type stores the settings only. The optimizer that reads them is not built yet (track item
 * AIR.7), so setting these fields changes nothing on its own today. Auto routing applies only
 * when a skill, or its scope default, selects `auto`; otherwise the pinned model is used exactly
 * as given and every field here is ignored.
 * @see {@link SkillModelMode}
 * @see {@link ModelRoutingDefault}
 */
export interface AutoRoutingConfig
{
  /** The optimization objective. */
  objective: AutoRoutingObjective;
  /** Cost↔quality dial for the `balanced` objective: 0 = cheapest … 10 = best. */
  costQualitySlider?: number;
  /** Minimum eval score a model must clear; defaults to the skill's own bar when omitted. */
  qualityFloor?: number;
  /** Hard per-decision spend ceiling in USD. */
  maxBudgetUsd?: number;
  /** Restrict auto to this subset of `publicModelName`s; must stay within the key's allowlist. */
  allowedModels?: string[];
  /** Reject/penalize models slower than this many milliseconds. */
  latencyCeilingMs?: number;
  /** Ordered fallback `publicModelName`s on failure/unavailability. */
  fallbacks?: string[];
  /** Keep the chosen model stable within a conversation to preserve prompt caches (default true). */
  sessionPin: boolean;
  /** Fraction of traffic to explore alternatives on (0 = pure exploit). */
  explorationRate: number;
}

/** The default model and auto-routing settings for one scope. Used only when a skill declares neither `pinned` nor `auto`. @see {@link SkillModelMode} */
export interface ModelRoutingDefault
{
  /** Stable identifier. */
  id: string;
  /** Whether this default is platform-wide or per-ClusterTenant. */
  scope: ModelRoutingScope;
  /** Owning ClusterTenant when `scope` is `clusterTenant`; null for Global. */
  clusterTenant: string | null;
  /** Default model `publicModelName` at this scope; null when unset. */
  defaultModel: string | null;
  /** Default auto-routing config at this scope; null when unset. */
  autoConfig: AutoRoutingConfig | null;
  /** Creation timestamp (ISO-8601). */
  createdAt: string;
  /** Last-update timestamp (ISO-8601). */
  updatedAt: string;
}

/** Create/update body for a {@link ModelRoutingDefault}. */
export interface ModelRoutingDefaultWrite
{
  /** Defaults to `global` when omitted. */
  scope?: ModelRoutingScope;
  /** Required when `scope` is `clusterTenant`. */
  clusterTenant?: string;
  /** Default model `publicModelName`. */
  defaultModel?: string;
	/** Default auto-routing config; explicit null clears the stored configuration. */
	autoConfig?: AutoRoutingConfig | null;
}
