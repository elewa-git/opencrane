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

/**
 * One provider's catalogue: the models a single BYOK key unlocks.
 *
 * The shape follows the hierarchy one provider ⇒ one key ⇒ many models. Setting a provider's key
 * writes ONE Kubernetes Secret and ONE LiteLLM credential, and every class in `models` is then
 * registered against that single credential — so LiteLLM can switch a call between tiers without
 * a second key.
 *
 * `embeddingModel` is the exception and is handled entirely differently; read its own doc before
 * touching it.
 */
export interface ByokProviderCatalog
{
  /** LiteLLM `custom_llm_provider` for the credential + slug prefix (`glm` ⇒ `zai`). */
  litellmProvider: string;
  /** Which class becomes the installation default — but only the first time. If any Global default already exists, setting up another provider leaves it alone. */
  defaultClass: ByokModelClassName;
  /** Model classes for this provider (≥1); ALL share the provider's single credential/key. */
  models: readonly ByokModelClass[];
  /**
   * The provider's embedding model, when it has one. Registered straight with LiteLLM by
   * `_ensureProviderEmbeddingModel` in `provision-byok-key.ts`, and deliberately NOT listed in
   * `models[]`.
   *
   * Here is why that matters. Every `models[]` class becomes a Global `ModelDefinition` row, and
   * `modelRegistryRouter` returns every Global row to every tenant as a selectable chat model. So
   * an embedding deployment listed in `models[]` would show up in tenants' chat-model pickers, and
   * a tenant choosing it would get failed calls — an embedding model cannot answer a chat request.
   * Keeping it out of `ModelDefinition` entirely is what prevents that.
   *
   * Internal callers that genuinely need it (Cognee, through its own dedicated LiteLLM key — see
   * `cognee-litellm-key.ts`) reference the slug directly instead. Absent means this provider has
   * no embedding model configured yet; that is normal, not every provider needs one.
   */
  embeddingModel?: { slug: string };
}
