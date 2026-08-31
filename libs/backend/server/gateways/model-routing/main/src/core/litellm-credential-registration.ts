import { ___DoWithTrace, ___MarkActiveSpanFailed, type Logger } from "@opencrane/backend/observability";

import { _log } from "../log";
import { LiteLlmCredentialMutationOutcomes, type LiteLlmCredentialUpsert } from "./litellm-credential-registration.types";

/**
 * Per-request timeout for the LiteLLM `/credentials` calls. It bounds each provider-command
 * delivery so an unreachable LiteLLM cannot hold the claim forever. A timeout yields an uncertain
 * result because the fixed-name mutation may still complete upstream and require reconciliation.
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
 * Existing credentials use LiteLLM's atomic PATCH endpoint. A confirmed 404 is the only condition
 * that permits POST, so a delayed earlier request can never delete a successfully retried key.
 *
 * @param input - The credential name, provider, and raw key to store in LiteLLM.
 * @param log - Logger that receives the secret-free mutation outcome.
 * @returns The confirmed, skipped, rejected, or uncertain fixed-name mutation outcome.
 */
export async function _UpsertLiteLlmCredential(input: LiteLlmCredentialUpsert, log: Logger = _log): Promise<LiteLlmCredentialMutationOutcomes>
{
  const endpoint = process.env.LITELLM_ENDPOINT?.trim() ?? "";
  const masterKey = process.env.LITELLM_MASTER_KEY?.trim() ?? "";
  if (!endpoint || !masterKey)
  {
	log.debug({ credentialName: input.credentialName, provider: input.provider, configured: false }, "litellm credential upsert skipped (unconfigured)");
    return LiteLlmCredentialMutationOutcomes.Skipped;
  }

  return ___DoWithTrace(
    "litellm.credential.upsert",
    { credentialName: input.credentialName, provider: input.provider },
	function _upsert(): Promise<LiteLlmCredentialMutationOutcomes> { return _upsertLive(endpoint, masterKey, input, log); },
  );
}

/**
 * Deletes a LiteLLM credential by name and reports whether the result is known.
 *
 * @param credentialName - The LiteLLM credential name to remove.
 * @param log - Logger that receives the secret-free mutation outcome.
 * @returns The confirmed, skipped, rejected, or uncertain fixed-name mutation outcome.
 */
export async function _DeleteLiteLlmCredential(credentialName: string, log: Logger = _log): Promise<LiteLlmCredentialMutationOutcomes>
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
	function _delete(): Promise<LiteLlmCredentialMutationOutcomes> { return _deleteLive(endpoint, masterKey, credentialName, log); },
  );
}

/**
 * Atomically updates an existing credential, or creates it only after PATCH confirms absence.
 * A transport failure yields an uncertain outcome because the request may still complete after
 * this process stops waiting.
 *
 * @param endpoint  - LiteLLM base URL.
 * @param masterKey - LiteLLM bearer credential.
 * @param input     - The credential to upsert.
 * @param log       - Logger that receives the secret-free mutation outcome.
 * @see https://github.com/BerriAI/litellm/blob/790a5ce0b323c1eefa70c2df25b2780097aa3f80/litellm/proxy/credential_endpoints/endpoints.py
 */
async function _upsertLive(endpoint: string, masterKey: string, input: LiteLlmCredentialUpsert, log: Logger): Promise<LiteLlmCredentialMutationOutcomes>
{
  try
  {
    const body = JSON.stringify({
      credential_name: input.credentialName,
      credential_info: { custom_llm_provider: input.provider },
      credential_values: { api_key: input.apiKey },
    });
    const headers = {
      "content-type": "application/json",
      Authorization: `Bearer ${masterKey}`,
    };

    // 1. PATCH replaces the encrypted value atomically. The pinned LiteLLM build updates the DB
    //    row in one operation and returns 404 without mutation when the fixed name is absent.
    const patched = await fetch(`${endpoint}/credentials/${encodeURIComponent(input.credentialName)}`, {
      method: "PATCH",
      headers,
      body,
      signal: AbortSignal.timeout(_LITELLM_HTTP_TIMEOUT_MS),
    });
    if (patched.ok)
    {
	  log.info({ credentialName: input.credentialName, provider: input.provider }, "litellm credential updated");
      return LiteLlmCredentialMutationOutcomes.Applied;
    }
    if (patched.status !== 404)
    {
	  ___MarkActiveSpanFailed();
	  log.warn({ credentialName: input.credentialName, provider: input.provider, status: patched.status }, "litellm credential update failed; key persisted to Secret only");
      return LiteLlmCredentialMutationOutcomes.Rejected;
    }

    // 2. POST only after the target confirms absence. A racing exact-command POST carries the same
    //    desired key, while a conflicting generation cannot be admitted through the command barrier.
    const created = await fetch(`${endpoint}/credentials`, {
      method: "POST",
      headers: {
        ...headers,
      },
      body,
      signal: AbortSignal.timeout(_LITELLM_HTTP_TIMEOUT_MS),
    });

    if (!created.ok)
    {
	  ___MarkActiveSpanFailed();
	  log.warn({ credentialName: input.credentialName, provider: input.provider, status: created.status }, "litellm credential create failed; key persisted to Secret only");
      return LiteLlmCredentialMutationOutcomes.Rejected;
    }

	log.info({ credentialName: input.credentialName, provider: input.provider }, "litellm credential upserted");
    return LiteLlmCredentialMutationOutcomes.Applied;
  }
  catch (err)
  {
	___MarkActiveSpanFailed();
	log.warn({ credentialName: input.credentialName, provider: input.provider, err }, "litellm credential upsert errored; key persisted to Secret only");
    return LiteLlmCredentialMutationOutcomes.Uncertain;
  }
}

/**
 * Perform the live `DELETE /credentials/<name>` call, treating a 404 as success (already gone).
 *
 * @param endpoint       - LiteLLM base URL.
 * @param masterKey      - LiteLLM bearer credential.
 * @param credentialName - The credential name to remove.
 * @param log            - Logger that receives the secret-free mutation outcome.
 */
async function _deleteLive(endpoint: string, masterKey: string, credentialName: string, log: Logger): Promise<LiteLlmCredentialMutationOutcomes>
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
	  ___MarkActiveSpanFailed();
	  log.warn({ credentialName, status: response.status }, "litellm credential delete failed");
      return LiteLlmCredentialMutationOutcomes.Rejected;
    }

    return LiteLlmCredentialMutationOutcomes.Applied;
  }
  catch (err)
  {
	___MarkActiveSpanFailed();
	log.warn({ credentialName, err }, "litellm credential delete errored");
    return LiteLlmCredentialMutationOutcomes.Uncertain;
  }
}
