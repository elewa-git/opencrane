/** Capability/cost tier a catalogued model occupies. */
export type ByokModelClassName = "flagship" | "balanced" | "fast";

/** One model class within a provider's catalog. */
export interface ByokModelClass
{
  /** The tier this model occupies. */
  className: ByokModelClassName;
  /** LiteLLM `litellm_params.model` slug (provider-prefixed); also used as the public model name. */
  slug: string;
}

/** A provider's model catalog: one credential (key) shared across several model classes. */
export interface ByokProviderCatalog
{
  /** LiteLLM `custom_llm_provider` for the credential + slug prefix (`glm` ⇒ `zai`). */
  litellmProvider: string;
  /** The class whose model claims the silo default when no Global default exists yet. */
  defaultClass: ByokModelClassName;
  /** Model classes for this provider (≥1); ALL share the provider's single credential/key. */
  models: readonly ByokModelClass[];
  /**
   * Optional embedding model, registered directly with LiteLLM (see
   * `provision-byok-key.ts` `_ensureProviderEmbeddingModel`) — deliberately NOT a `models[]`
   * entry: every `models[]` class becomes a Global `ModelDefinition` row, and
   * `tenant-models.ts` exposes ALL Global rows unconditionally as tenant-selectable CHAT
   * models. An embedding deployment must never appear there, so it bypasses `ModelDefinition`
   * entirely — internal callers needing it (Cognee, via its own dedicated LiteLLM key; see
   * `cognee-litellm-key.ts`) reference the slug directly. Absent ⇒ no embedding model for
   * this provider yet (set only where needed, not required for every provider).
   */
  embeddingModel?: { slug: string };
}
