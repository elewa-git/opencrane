import { ___DoWithTrace } from "@opencrane/backend/observability";

import { _log } from "../log";
import { LiteLlmCredentialMutationOutcomes, type LiteLlmCredentialUpsert } from "./litellm-credential-registration.types";

/**
 * Per-request timeout for the LiteLLM `/credentials` calls. Bounds the boot-time bootstrap (which
 * awaits these) so a hung or unreachable LiteLLM cannot wedge silo controller startup. A timeout
 * yields an uncertain result because the fixed-name mutation may still complete upstream.
 */
const _LITELLM_HTTP_TIMEOUT_MS = 10_000;

/**
 * Upserts a provider credential into LiteLLM through its fixed-name `/credentials` API.
 *
 * Guarded by `LITELLM_ENDPOINT` + `LITELLM_MASTER_KEY`: when either is unset (dev / tests) this is
 * a skipped outcome, so the BYOK set path stays functional without a live LiteLLM. The
 * raw key still persists to its k8s Secret and the ProviderCredential row, and the credential can
 * be reconciled later. A response distinguishes a confirmed rejection from a transport failure
 * whose upstream result is unknown, so callers can retain their resource barrier when necessary.
 *
 * Upsert is implemented as delete-then-create so a refreshed key always replaces the stored value
 * regardless of whether the LiteLLM build exposes a credential update verb.
 *
 * @param input - The credential name, provider, and raw key to store in LiteLLM.
 * @returns The confirmed, skipped, rejected, or uncertain fixed-name mutation outcome.
 */
export async function _UpsertLiteLlmCredential(input: LiteLlmCredentialUpsert): Promise<LiteLlmCredentialMutationOutcomes>
{
  const endpoint = process.env.LITELLM_ENDPOINT?.trim() ?? "";
  const masterKey = process.env.LITELLM_MASTER_KEY?.trim() ?? "";
  if (!endpoint || !masterKey)
  {
    _log.debug({ credentialName: input.credentialName, provider: input.provider, configured: false }, "litellm credential upsert skipped (unconfigured)");
    return LiteLlmCredentialMutationOutcomes.Skipped;
  }

  return ___DoWithTrace(
    "litellm.credential.upsert",
    { credentialName: input.credentialName, provider: input.provider },
    function _upsert(): Promise<LiteLlmCredentialMutationOutcomes> { return _upsertLive(endpoint, masterKey, input); },
  );
}

/**
 * Deletes a LiteLLM credential by name and reports whether the result is known.
 *
 * @param credentialName - The LiteLLM credential name to remove.
 * @returns The confirmed, skipped, rejected, or uncertain fixed-name mutation outcome.
 */
export async function _DeleteLiteLlmCredential(credentialName: string): Promise<LiteLlmCredentialMutationOutcomes>
{
  const endpoint = process.env.LITELLM_ENDPOINT?.trim() ?? "";
  const masterKey = process.env.LITELLM_MASTER_KEY?.trim() ?? "";
  if (!endpoint || !masterKey)
  {
    return LiteLlmCredentialMutationOutcomes.Skipped;
  }

  return ___DoWithTrace(
    "litellm.credential.delete",
    { credentialName },
    function _delete(): Promise<LiteLlmCredentialMutationOutcomes> { return _deleteLive(endpoint, masterKey, credentialName); },
  );
}

/**
 * Performs the live delete-then-create against LiteLLM. The delete clears any prior value so a
 * refreshed key replaces it; the create stores the new value. A transport failure yields an
 * uncertain outcome because the request may still complete after this process stops waiting.
 *
 * @param endpoint  - LiteLLM base URL.
 * @param masterKey - LiteLLM bearer credential.
 * @param input     - The credential to upsert.
 */
async function _upsertLive(endpoint: string, masterKey: string, input: LiteLlmCredentialUpsert): Promise<LiteLlmCredentialMutationOutcomes>
{
  try
  {
    // 1. Clear any existing value first so a refresh is a true replace (idempotent — 404 is fine).
    const deleted = await _deleteLive(endpoint, masterKey, input.credentialName);
    if (deleted === LiteLlmCredentialMutationOutcomes.Uncertain)
      return deleted;

    // 2. Create the credential carrying the raw key inline. LiteLLM encrypts it at rest with
    //    LITELLM_SALT_KEY; the key is never echoed back or copied into a runtime configuration.
    const response = await fetch(`${endpoint}/credentials`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${masterKey}`,
      },
      body: JSON.stringify({
        credential_name: input.credentialName,
        credential_info: { custom_llm_provider: input.provider },
        credential_values: { api_key: input.apiKey },
      }),
      signal: AbortSignal.timeout(_LITELLM_HTTP_TIMEOUT_MS),
    });

    if (!response.ok)
    {
      _log.warn({ credentialName: input.credentialName, provider: input.provider, status: response.status }, "litellm credential upsert failed; key persisted to Secret only");
      return LiteLlmCredentialMutationOutcomes.Rejected;
    }

    _log.info({ credentialName: input.credentialName, provider: input.provider }, "litellm credential upserted");
    return LiteLlmCredentialMutationOutcomes.Applied;
  }
  catch (err)
  {
    _log.warn({ credentialName: input.credentialName, provider: input.provider, err }, "litellm credential upsert errored; key persisted to Secret only");
    return LiteLlmCredentialMutationOutcomes.Uncertain;
  }
}

/**
 * Perform the live `DELETE /credentials/<name>` call, treating a 404 as success (already gone).
 *
 * @param endpoint       - LiteLLM base URL.
 * @param masterKey      - LiteLLM bearer credential.
 * @param credentialName - The credential name to remove.
 */
async function _deleteLive(endpoint: string, masterKey: string, credentialName: string): Promise<LiteLlmCredentialMutationOutcomes>
{
  try
  {
    const response = await fetch(`${endpoint}/credentials/${encodeURIComponent(credentialName)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${masterKey}` },
      signal: AbortSignal.timeout(_LITELLM_HTTP_TIMEOUT_MS),
    });

    if (!response.ok && response.status !== 404)
    {
      _log.warn({ credentialName, status: response.status }, "litellm credential delete failed");
      return LiteLlmCredentialMutationOutcomes.Rejected;
    }

    return LiteLlmCredentialMutationOutcomes.Applied;
  }
  catch (err)
  {
    _log.warn({ credentialName, err }, "litellm credential delete errored");
    return LiteLlmCredentialMutationOutcomes.Uncertain;
  }
}
