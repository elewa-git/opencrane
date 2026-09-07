/**
 * Request to mint one LiteLLM virtual key for a single run attempt.
 *
 * A run's pod never gets the LiteLLM master key or a provider's key. It gets one of these instead:
 * a key that can call exactly one model, has a total spend ceiling, and dies with the attempt.
 * A leaked attempt key therefore costs at most one budget on one model for the rest of one lease.
 *
 * Every field is validated by `_IssueAttemptLiteLlmKey` before the mint, and issuance fails hard
 * rather than falling back — a run cannot proceed without its own scoped key.
 *
 * @see LiteLLM proxy `POST /key/generate`, pinned to `main-v1.81.0-stable` by `litellm.image.tag`
 *      in apps/_infra/deploy-k8s/values.yaml.
 * @see https://github.com/BerriAI/litellm/blob/v1.81.0-stable/litellm/proxy/management_endpoints/key_management_endpoints.py
 */
export interface AttemptLiteLlmKeyRequest
{
  /** The key's alias. Must match `_ATTEMPT_KEY_ALIAS` (`attempt-` then lowercase letters, digits and dashes, 63 max) — issuance throws otherwise, so a caller cannot ask for an unscoped key by naming it something else. */
  keyAlias: string;
  /** Single LiteLLM model alias the minted key is permitted to call. */
  modelAlias: string;
  /** Hard aggregate spend ceiling in US dollars bound to the key. */
  maxBudgetUsd: number;
  /** Key lifetime in seconds, bounded to the attempt lease. */
  expirySeconds: number;
  /** Absolute authority deadline; minting latency must not extend this instant. */
  notAfter: string;
}

/** Requests revocation of one newly minted, unused LiteLLM virtual key. */
export interface AttemptLiteLlmKeyRevocation
{
	/** Names the task-scoped key without exposing its raw credential in traces or logs. */
	keyAlias: string;
	/** Carries the raw unused virtual key only to LiteLLM's revocation request. */
	key: string;
}

/** Requests cleanup by the deterministic attempt alias when the raw key was not retained. */
export interface AttemptLiteLlmKeyAliasRevocation
{
	/** Names the exact attempt key recorded before provider issuance. */
	keyAlias: string;
}

/**
 * A freshly minted attempt key, plus the bindings it was issued under.
 *
 * `key` is a live credential. The server keeps its encrypted custody record and hands it only to
 * the currently authenticated conversation computer over private transport. It must never enter
 * logs, conversation history or a public response. The returned expiry is the provider's evidence.
 */
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
  /** Provider-reported expiry, checked against the absolute authority deadline before handoff. */
  expiresAt: string;
}
