/**
 * Inputs for a best-effort LiteLLM `/credentials` upsert — the BYOK "dynamic no-restart path".
 *
 * Unlike {@link LiteLlmModelRegistration} (which references a key via `os.environ/<ref>` — the
 * env baseline), a credential carries the RAW provider key inline. LiteLLM persists it in its
 * own DB-backed store encrypted with `LITELLM_SALT_KEY`, so a model that references the credential
 * by name picks up the key with no pod restart and the key never lands in runtime configuration.
 */
export interface LiteLlmCredentialUpsert
{
  /** The credential name models reference via `litellm_params.litellm_credential_name`. */
  credentialName: string;
  /** The LiteLLM provider this key authenticates, e.g. `openai`, `anthropic`, `gemini`. */
  provider: string;
  /** The raw upstream provider API key. Never logged, never returned to a caller. */
  apiKey: string;
}

/** Outcomes of one fixed-name LiteLLM credential mutation. */
export enum LiteLlmCredentialMutationOutcomes
{
  /** LiteLLM confirmed that it applied the requested credential state. */
  Applied = "applied",
  /** No LiteLLM endpoint is configured, so no upstream request was attempted. */
  Skipped = "skipped",
  /** LiteLLM returned a response that rejected the requested mutation. */
  Rejected = "rejected",
  /** The request ended without a response, so LiteLLM may still have applied the mutation. */
  Uncertain = "uncertain",
}
