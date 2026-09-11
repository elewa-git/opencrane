/**
 * Per-provider model catalog seeded when a provider's BYOK key is set.
 *
 * Hierarchy — one provider ⇒ one key ⇒ many models: setting a provider's key writes ONE k8s Secret
 * and ONE LiteLLM `/credentials` entry, then registers every class below bound to that single
 * credential. So all of a provider's model classes authenticate with the same key, and LiteLLM can
 * switch freely across tiers on it (the routing layer picks; the {@link ByokProviderCatalog.defaultClass}
 * model only claims the silo default when no default exists yet).
 *
 * Slugs are current production LiteLLM ids verified 2026-07-01 — update
 * the package-root `byok-provider-catalog.json` public artifact as providers ship models.
 * `litellmProvider` is LiteLLM's `custom_llm_provider` (and slug prefix); it equals the BYOK provider
 * key EXCEPT GLM, which is `zai` in LiteLLM (the `zhipu/` prefix is rejected). A registration with an
 * unknown slug simply fails to route until corrected — it never affects the stored key.
 *
 * Notes: DeepSeek's current V4 family is Pro + Flash only (two classes, not three). Gemini's flagship
 * may require the `-preview` suffix on some LiteLLM builds (`gemini/gemini-3.1-pro-preview`) — the
 * best-effort registration isolates a 404 to that one model.
 */

import catalog from "../../byok-provider-catalog.json" with { type: "json" };

import type { ByokProviderCatalog } from "./byok-default-models.types";

/** BYOK provider key → its model catalog. Absent providers set a key but seed no model. */
export const _BYOK_PROVIDER_CATALOG = catalog as Readonly<Record<string, ByokProviderCatalog>>;
