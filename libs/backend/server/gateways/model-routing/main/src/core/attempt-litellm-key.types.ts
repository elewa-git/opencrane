/**
 * Request to mint one attempt-scoped LiteLLM virtual key.
 *
 * The key is bound to exactly one model alias and one aggregate budget, expires with the attempt
 * lease, and is the runtime's only route to a model. It never carries or exposes the LiteLLM master
 * key or an upstream provider secret.
 */
export interface AttemptLiteLlmKeyRequest
{
  /** Attempt-scoped key alias; must match the `attempt-<...>` grammar the issuer enforces. */
  keyAlias: string;
  /** Single LiteLLM model alias the minted key is permitted to call. */
  modelAlias: string;
  /** Hard aggregate spend ceiling in US dollars bound to the key. */
  maxBudgetUsd: number;
  /** Key lifetime in seconds, bounded to the attempt lease. */
  expirySeconds: number;
}

/** A minted attempt-scoped LiteLLM virtual key returned to the caller for Secret projection. */
export interface AttemptLiteLlmKey
{
  /** The short-lived virtual key value the runtime presents to the LiteLLM proxy. */
  key: string;
  /** The alias the key was bound to, echoed for the caller's Secret naming. */
  keyAlias: string;
  /** The single model alias the key is permitted to call. */
  modelAlias: string;
  /** The lifetime in seconds the key was minted with. */
  expirySeconds: number;
}
