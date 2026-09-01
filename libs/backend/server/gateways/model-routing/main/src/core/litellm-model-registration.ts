import { ___DoWithTrace } from "@opencrane/backend/observability";
import type { Logger } from "@opencrane/backend/observability";
import { ___ParseAndValidateJson } from "@opencrane/util";

import { _log } from "../log";
import { _ConvergeLiteLlmModelDeployment } from "./litellm-model-deletion";
import type { LiteLlmModelRegistration } from "./litellm-model-registration.types";

/**
 * Best-effort GLOBAL registration of a model with LiteLLM via `POST /model/new`.
 *
 * Guarded by `LITELLM_ENDPOINT` + `LITELLM_MASTER_KEY`: when either is unset (dev / tests),
 * this returns a deterministic placeholder id derived from `publicModelName` and never calls
 * out, so the opencrane-ui create path stays functional without a live LiteLLM. The call is
 * non-fatal and isolated — a LiteLLM error also falls back to the placeholder rather than
 * failing the create, mirroring the resilient-fetch posture elsewhere in the platform.
 *
 * The registration is intentionally GLOBAL: it never sets `model_info.team_id` (Enterprise-gated).
 * Per-tenant access is scoped later via the virtual key's `models[]` allowlist, not here.
 *
 * @param input - The public slug, upstream model, and optional api_base/secret env reference.
 * @param log - Logger that receives registration outcomes.
 * @returns The LiteLLM-returned deployment id, or a deterministic placeholder when unconfigured.
 */
export async function _RegisterLiteLlmModel(input: LiteLlmModelRegistration, log: Logger = _log): Promise<string>
{
  const endpoint = process.env.LITELLM_ENDPOINT?.trim() ?? "";
  const masterKey = process.env.LITELLM_MASTER_KEY?.trim() ?? "";
  const configured = Boolean(endpoint && masterKey);

  // 1. Unconfigured (dev / tests): skip the network call and return a stable placeholder
  //    so creates succeed and are reproducible without a live LiteLLM.
  if (!configured)
  {
    if (input.requireLiveRegistration)
    {
      throw new Error(`LiteLLM is not configured to register required model '${input.publicModelName}'`);
    }
    const placeholder = _placeholderModelId(input);
		log.debug({ publicModelName: input.publicModelName, configured: false, litellmModelId: placeholder }, "litellm model registration skipped (unconfigured)");
    return placeholder;
  }

  return ___DoWithTrace(
    "litellm.model.register",
    { publicModelName: input.publicModelName, upstreamModel: input.upstreamModel, scope: input.scope },
		function _register(): Promise<string> { return _registerLive(endpoint, masterKey, input, log); },
  );
}

/**
 * Perform the live `POST /model/new` registration against LiteLLM, falling back to a deterministic
 * placeholder on any non-OK response or network/parse error so the create path never fails.
 * @param endpoint  - LiteLLM base URL.
 * @param masterKey - LiteLLM bearer credential.
 * @param input     - The registration inputs.
 * @param log       - Logger that receives registration outcomes.
 * @returns The LiteLLM deployment id, or a placeholder when the call fails.
 */
async function _registerLive(endpoint: string, masterKey: string, input: LiteLlmModelRegistration, log: Logger): Promise<string>
{
  try
  {
    // 2. Reuse the deployment already stored under this product-owned public name. A delivery may
    //    have reached LiteLLM before its database finalization, so retries reconcile before POST.
    const existing = await _ConvergeLiteLlmModelDeployment(endpoint, masterKey, input, log);
    if (existing !== null)
      return existing;

    // 3. Register the deployment GLOBALLY. Prefer the BYOK dynamic path: when a credential name is
    //    bound, reference it via `litellm_credential_name` so LiteLLM resolves the key from its
    //    encrypted store. Otherwise fall back to the env baseline — `api_key` as an `os.environ/<KEY>`
    //    reference so the raw key never transits OpenCrane (LiteLLM reads it from its own environment).
    const litellmParams: Record<string, unknown> = { model: input.upstreamModel };
    if (input.apiBase)
    {
      litellmParams.api_base = input.apiBase;
    }
    if (input.litellmCredentialName)
    {
      litellmParams.litellm_credential_name = input.litellmCredentialName;
    }
    else if (input.apiKeyEnvRef)
    {
      litellmParams.api_key = `os.environ/${input.apiKeyEnvRef}`;
    }

    const response = await fetch(`${endpoint}/model/new`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${masterKey}`,
      },
      body: JSON.stringify({
        model_name: input.publicModelName,
        litellm_params: litellmParams,
        // Explicit mode (e.g. "embedding") rather than relying on LiteLLM's own model-name
        // inference — omitted (LiteLLM defaults to chat) for the ordinary catalog models.
		..._ModelInfo(input),
      }),
      // Startup readiness must bound each upstream registration, just as inventory checks do.
      // Otherwise a stalled LiteLLM socket prevents Kubernetes from ever observing failure.
      signal: AbortSignal.timeout(10_000),
    });

    // 4. On any non-OK upstream response fall back to the placeholder — the row still persists,
    //    and the deployment can be reconciled later; the create must not fail on a flaky LiteLLM.
    if (!response.ok)
    {
      if (input.requireLiveRegistration)
      {
        throw new Error(`LiteLLM model registration for '${input.publicModelName}' returned HTTP ${response.status}`);
      }
	  log.warn({ publicModelName: input.publicModelName, status: response.status }, "litellm model registration failed; using placeholder id");
      return _placeholderModelId(input);
    }

    const litellmModelId = ___ParseAndValidateJson(await response.text(), "LiteLLM model registration response", _RegisteredModelId, input);
    if (input.requireLiveRegistration && litellmModelId.startsWith("placeholder:"))
    {
      throw new Error(`LiteLLM did not return a deployment id for required model '${input.publicModelName}'`);
    }
	log.info({ publicModelName: input.publicModelName, litellmModelId }, "litellm model registered");
    return litellmModelId;
  }
  catch (err)
  {
    if (input.requireLiveRegistration)
    {
      throw err;
    }
    // 5. Network / parse failure is non-fatal — keep the create working with a placeholder.
	log.warn({ publicModelName: input.publicModelName, err }, "litellm model registration errored; using placeholder id");
    return _placeholderModelId(input);
  }
}

/** Build the optional LiteLLM model_info object without inventing absent values. */
function _ModelInfo(input: LiteLlmModelRegistration): { readonly model_info?: { readonly id?: string; readonly mode?: string } }
{
	const modelInfo: { id?: string; mode?: string } = {};
	if (input.deploymentId)
		modelInfo.id = input.deploymentId;
	if (input.mode)
		modelInfo.mode = input.mode;
	return Object.keys(modelInfo).length === 0 ? {} : { model_info: modelInfo };
}

/** Select one non-empty LiteLLM deployment id or use the deterministic local placeholder. */
function _RegisteredModelId(value: unknown, input: LiteLlmModelRegistration): string
{
  if (typeof value !== "object" || value === null || Array.isArray(value)) return _placeholderModelId(input);
  const payload = value as Record<string, unknown>;
  if (typeof payload["model_id"] === "string" && payload["model_id"].length > 0) return payload["model_id"];
  if (typeof payload["id"] === "string" && payload["id"].length > 0) return payload["id"];
  if (typeof payload["model_info"] === "object" && payload["model_info"] !== null && !Array.isArray(payload["model_info"]))
  {
    const nestedId = (payload["model_info"] as Record<string, unknown>)["id"];
    if (typeof nestedId === "string" && nestedId.length > 0) return nestedId;
  }
  return _placeholderModelId(input);
}

/**
 * Build a deterministic placeholder deployment id, used when LiteLLM is unconfigured or
 * unreachable. The id incorporates scope + owning clusterTenant so it stays unique under the
 * `litellmModelId` global `@unique` constraint even when the same `publicModelName` is
 * registered at different scopes (e.g. a Global model and a ClusterTenant override sharing a
 * slug). Deterministic so tests and the unique constraint behave predictably.
 *
 * @param input - The registration inputs carrying the slug, scope, and owning clusterTenant.
 * @returns A stable `placeholder:<scope>:<clusterTenant?>:<slug>` id.
 */
function _placeholderModelId(input: LiteLlmModelRegistration): string
{
  const parts = [input.scope, input.clusterTenant ?? "", input.publicModelName].join(":");
  // Collapse every run of non-alphanumerics to a single dash first, so at most one leading/
  // trailing dash can remain — then strip that single dash. Trimming with `-+` here would be a
  // polynomial-ReDoS sink on attacker-influenced model names; the single-char `^-|-$` is linear.
  const slug = parts.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `placeholder:${slug}`;
}
