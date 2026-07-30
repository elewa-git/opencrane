import { ___DoWithTrace } from "@opencrane/observability";
import { ___ParseAndValidateJson } from "@opencrane/util";

import { _log } from "../log.js";
import type { AttemptLiteLlmKey, AttemptLiteLlmKeyRequest } from "./attempt-litellm-key.types.js";

/**
 * Per-request timeout for the LiteLLM `/key/generate` call. Bounds the mint so an unreachable
 * LiteLLM cannot wedge command dispatch; on timeout the fetch aborts and the mint fails hard.
 */
const _LITELLM_HTTP_TIMEOUT_MS = 10_000;

/** Grammar an attempt-scoped key alias must satisfy so a caller cannot mint an unscoped master key. */
const _ATTEMPT_KEY_ALIAS = /^attempt-[a-z0-9][a-z0-9-]{0,62}$/;

/** Hard ceiling on the minted key lifetime so a mis-supplied lease cannot outlive an attempt. */
const _MAX_EXPIRY_SECONDS = 86_400;

/**
 * Mint one short-lived, alias- and budget-bound LiteLLM virtual key for a single run attempt.
 *
 * Reusing the client posture of the BYOK `/credentials` path, this calls LiteLLM's `/key/generate`
 * with the master key as the bearer and returns the minted virtual key for the Job builder to
 * project as a group-readable Secret. Unlike the best-effort credential upsert, issuance fails hard:
 * a missing endpoint or master key, a rejected alias, an unbounded budget or expiry, or any non-OK
 * LiteLLM response throws, because a run cannot proceed without its own scoped key. The master key
 * and upstream provider secrets never leave the control plane.
 *
 * @param input - The alias, single model alias, budget, and expiry the key is bound to.
 * @returns The minted virtual key and the exact bindings it was issued under.
 */
export async function _IssueAttemptLiteLlmKey(input: AttemptLiteLlmKeyRequest): Promise<AttemptLiteLlmKey>
{
  // 1. Reject an alias, budget, or expiry that would widen the key beyond one bounded attempt.
  if (!_ATTEMPT_KEY_ALIAS.test(input.keyAlias)) throw new Error("attempt LiteLLM key requires an attempt-scoped alias");
  if (typeof input.modelAlias !== "string" || input.modelAlias.trim().length === 0) throw new Error("attempt LiteLLM key requires a single model alias");
  if (!Number.isFinite(input.maxBudgetUsd) || input.maxBudgetUsd <= 0) throw new Error("attempt LiteLLM key requires a positive budget");
  if (!Number.isSafeInteger(input.expirySeconds) || input.expirySeconds <= 0 || input.expirySeconds > _MAX_EXPIRY_SECONDS) throw new Error("attempt LiteLLM key requires a bounded positive expiry");

  const endpoint = process.env.LITELLM_ENDPOINT?.trim() ?? "";
  const masterKey = process.env.LITELLM_MASTER_KEY?.trim() ?? "";
  if (!endpoint || !masterKey) throw new Error("attempt LiteLLM key issuance requires LITELLM_ENDPOINT and LITELLM_MASTER_KEY");

  return ___DoWithTrace(
    "litellm.key.generate",
    { keyAlias: input.keyAlias, modelAlias: input.modelAlias },
    function _mint(): Promise<AttemptLiteLlmKey> { return _mintLive(endpoint, masterKey, input); },
  );
}

/** Perform the live `/key/generate` mint, binding the single model, budget, and expiry to the key. */
async function _mintLive(endpoint: string, masterKey: string, input: AttemptLiteLlmKeyRequest): Promise<AttemptLiteLlmKey>
{
  const response = await fetch(`${endpoint}/key/generate`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${masterKey}`,
    },
    body: JSON.stringify({
      models: [input.modelAlias],
      key_alias: input.keyAlias,
      max_budget: input.maxBudgetUsd,
      budget_duration: `${input.expirySeconds}s`,
      duration: `${input.expirySeconds}s`,
      metadata: { opencrane_scope: "agent-runtime-attempt", opencrane_key_alias: input.keyAlias },
    }),
    signal: AbortSignal.timeout(_LITELLM_HTTP_TIMEOUT_MS),
  });

  if (!response.ok)
  {
    _log.warn({ keyAlias: input.keyAlias, modelAlias: input.modelAlias, status: response.status }, "litellm attempt key mint failed");
    throw new Error(`litellm attempt key mint returned status ${response.status}`);
  }

  const key = ___ParseAndValidateJson(await response.text(), "LiteLLM attempt key response", _MintedKey);

  _log.info({ keyAlias: input.keyAlias, modelAlias: input.modelAlias }, "litellm attempt key minted");
  return { key, keyAlias: input.keyAlias, modelAlias: input.modelAlias, expirySeconds: input.expirySeconds };
}

/** Validate the non-empty virtual key returned by LiteLLM. */
function _MintedKey(value: unknown): string
{
  if (typeof value !== "object" || value === null || Array.isArray(value) || !("key" in value) || typeof value.key !== "string" || value.key.length === 0) throw new Error("litellm attempt key mint returned no key");
  return value.key;
}
