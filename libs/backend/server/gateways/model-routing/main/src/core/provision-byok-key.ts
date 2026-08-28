import { Buffer } from "node:buffer";

import * as k8s from "@kubernetes/client-node";
import type { Prisma } from "@prisma/client";
import { _DeleteLiteLlmCredential, _UpsertLiteLlmCredential } from "./litellm-credential-registration";
import { _BYOK_PROVIDER_CATALOG } from "./byok-default-models";
import { PrismaGlobalModelRoutingDefaultRepository } from "./prisma-global-model-routing-default-repository";
import { PrismaGlobalProviderCredentialProjectionRepository } from "./prisma-provider-credential-projection-repository";
import { PrismaProviderModelEvidenceRepository } from "./prisma-provider-model-evidence-repository";
import { _EnsureProviderModels, _ValidateBootstrapModel } from "./provider-model-bootstrap";
import { _EnsureProviderEmbeddingModels } from "./provider-embedding-models";
import type { DeprovisionByokKeyOptions, ProvisionByokKeyOptions, ProvisionByokKeyResult } from "./provision-byok-key.types";

export { _AUTO_EMBEDDING_MODEL_NAME } from "./provider-embedding-models";

/**
 * Setting and removing a silo's BYOK provider key. Both the HTTP route (`providerByokRouter`) and
 * the boot-time bootstrap call these functions, which is why they live here and not in `routes/` —
 * the boot path has no HTTP request to go through.
 *
 * Setting a key, in order: write the raw key to a Kubernetes Secret (the durable copy), push it to
 * LiteLLM's `/credentials` (best-effort), write the Global `ProviderCredential` row, then seed the
 * models bound to it. A strict deployment bootstrap may additionally select one reviewed model
 * newer than the static class catalogue. NOTE: the row this file writes is always Global (`scope: "Global"`,
 * `clusterTenant: null`) — the ClusterTenant-scoped variant is written through
 * `providerCredentialsRouter`, not here.
 */

/**
 * Build the name of the Kubernetes Secret that holds a provider's raw BYOK key.
 *
 * The name is fixed per provider, and that is a security constraint rather than a convenience: the
 * server's Role grants it `get`/`update` on exactly these Secret names, so the server can rewrite
 * a key it already has but cannot invent new Secret names or delete existing ones. Deployment
 * pre-creates every Secret in the fixed provider catalogue — see `_clearProviderKeySecret`, which
 * blanks the value instead of deleting the object.
 *
 * Called by: `_ProvisionByokKey`, `_DeprovisionByokKey`, `_applyProviderKeySecret` and
 * `_clearProviderKeySecret` in this file.
 *
 * @param provider - Provider key, e.g. `openai`.
 * @returns `byok-provider-key-<provider>`.
 */
export function _byokSecretName(provider: string): string
{
  return `byok-provider-key-${provider}`;
}

/**
 * Build the name a provider's key is stored under in LiteLLM's `/credentials` store.
 *
 * Derived from the provider rather than chosen, so the set path and the remove path always agree
 * on the name, and so a model registration can reference it via `litellm_credential_name`.
 *
 * Called by: `_ProvisionByokKey` and `_DeprovisionByokKey` in this file.
 *
 * @param provider - Provider key, e.g. `openai`.
 * @returns `byok-<provider>`.
 */
export function _byokCredentialName(provider: string): string
{
  return `byok-${provider}`;
}

/**
 * Set or refresh a provider's raw BYOK key, then get the platform ready to route on it.
 *
 * Five stages run in this order for a reason: write the key to its Kubernetes Secret first (that
 * Secret is the durable copy and survives a LiteLLM database reset), push it to LiteLLM's
 * `/credentials`, record the `ProviderCredential` row, seed the provider model catalogue plus an
 * exact reviewed bootstrap model when supplied, and finally register the provider's embedding
 * model.
 *
 * Steps 2, 4 and 5 are best-effort by default: if LiteLLM is unconfigured or down, the key is
 * still set and the platform converges on a later call. `requireLiveModels` flips that — see
 * `ProvisionByokKeyOptions.requireLiveModels` — and is what the boot-time bootstrap uses so a
 * fresh install refuses to come up half-configured instead of accepting traffic it cannot serve.
 *
 * The raw key is written only to the Secret and to LiteLLM. It is never logged and never returned.
 *
 * Called by: the `PUT /:provider` handler in `providerByokRouter`
 * (libs/backend/server/gateways/providers/main/src/routes/provider-byok.ts, org-admin gated), and
 * apps/opencrane/src/app/initial-model-bootstrap.ts, which passes `requireLiveModels: true`.
 *
 * @param opts.prisma            - Prisma client for the credential + model rows.
 * @param opts.coreApi           - Kubernetes Core V1 API for the Secret write.
 * @param opts.operatorNamespace - The operator's own namespace (where the silo's keys live).
 * @param opts.provider          - The provider the key is for (e.g. `openai`).
 * @param opts.selectedModel     - Exact reviewed first-install model, including its LiteLLM namespace.
 * @param opts.apiKey            - The raw upstream key (never logged or echoed).
 * @param opts.log               - Scoped logger for the best-effort model-seed warning.
 * @param opts.requireLiveModels - When true, a failed model or embedding registration throws
 *                                 instead of only logging a warning. Defaults to false.
 * @returns Whether LiteLLM accepted the key, and the `ProviderCredential` row that was written.
 *          `litellmRegistered: false` means the key is set but only in its Secret.
 * @throws Whatever the Kubernetes client throws when the Secret cannot be written — the key is
 *         then not set at all. With `requireLiveModels: true`, also whatever a failed model or
 *         embedding registration throws, after the Secret and row have already been written.
 * @see LiteLLM proxy, pinned to `main-v1.81.0-stable` by `litellm.image.tag` in
 *      apps/_infra/deploy-k8s/values.yaml — the `/credentials`, `/model/new` and `/model/info`
 *      endpoints this path calls. NEEDS-HUMAN: add the docs URI for that release.
 */
export async function _ProvisionByokKey(opts: ProvisionByokKeyOptions): Promise<ProvisionByokKeyResult>
{
  const { prisma, coreApi, operatorNamespace, provider, selectedModel, apiKey, log, requireLiveModels = false } = opts;
  const catalog = _BYOK_PROVIDER_CATALOG[provider];
  _ValidateBootstrapModel(provider, catalog, selectedModel, requireLiveModels);

  // 1. Persist the raw key to its k8s Secret first — the durable source of truth.
  await _applyProviderKeySecret(coreApi, operatorNamespace, provider, apiKey);

  // 2. Best-effort push to LiteLLM's /credentials dynamic path; Secret-only when unconfigured/down.
  //    custom_llm_provider is the catalog's litellmProvider (glm ⇒ zai), falling back to the key.
  const credentialName = _byokCredentialName(provider);
  const litellmRegistered = await _UpsertLiteLlmCredential({ credentialName, provider: catalog?.litellmProvider ?? provider, apiKey });

  // 3. Record the credential reference (litellmCredentialName set only when LiteLLM accepted it).
  const secretRef = _byokSecretName(provider);
  const litellmCredentialName = litellmRegistered ? credentialName : null;
  const projectionPrisma: Prisma.TransactionClient = prisma;
  const credentialProjection = new PrismaGlobalProviderCredentialProjectionRepository(projectionPrisma);
  const projectionCommand = {
    provider,
    secretRef,
    litellmCredentialName,
  };
  const row = await credentialProjection.upsertGlobal(projectionCommand);

  // 4. Best-effort: register EVERY model class for the provider, all bound to this one credential,
  //    so LiteLLM can switch across tiers on the single key. Never fail the set if this trips.
  try
  {
    const models = new PrismaProviderModelEvidenceRepository(projectionPrisma);
    const routingDefaults = new PrismaGlobalModelRoutingDefaultRepository(projectionPrisma);
    const repositories = {
      models,
      routingDefaults,
    };
    await _EnsureProviderModels(repositories, catalog, row.id, litellmCredentialName, requireLiveModels, selectedModel);
  }
  catch (err)
  {
    if (requireLiveModels) throw err;
    log.warn({ provider, err }, "byok model seed failed; key is set but its models were not seeded");
  }

  // 5. Best-effort: register the provider's embedding model (if catalogued) directly with LiteLLM —
  //    deliberately OUTSIDE step 4's ModelDefinition path (see ByokProviderCatalog.embeddingModel).
  try
  {
    await _EnsureProviderEmbeddingModels(catalog, litellmCredentialName, log, requireLiveModels);
  }
  catch (err)
  {
    if (requireLiveModels) throw err;
    log.warn({ provider, err }, "byok embedding model registration failed; key is set but no embedding model was registered");
  }

  return { litellmRegistered, row };
}

/**
 * Remove a provider's BYOK key: blank the Secret's value, drop the LiteLLM credential, delete the
 * `ProviderCredential` row.
 *
 * The Secret OBJECT is deliberately kept, with an empty value. The server's Role can update these
 * fixed Secret names but cannot create or delete them, so deleting the object would leave nothing
 * for a later `PUT` to write into and the provider could never be re-enabled without a redeploy.
 *
 * Any `ModelDefinition` rows that referenced the credential are left in place; they simply stop
 * resolving until a key is set again.
 *
 * Called by: the `DELETE /:provider` handler in `providerByokRouter`
 * (libs/backend/server/gateways/providers/main/src/routes/provider-byok.ts, org-admin gated).
 *
 * @param opts.prisma            - Prisma client.
 * @param opts.coreApi           - Kubernetes Core V1 API.
 * @param opts.operatorNamespace - The operator's own namespace.
 * @param opts.provider          - The provider whose key to remove.
 * @throws Error when the provider's Secret is missing entirely, which means deployment never
 *         pre-created it; the LiteLLM credential and the row are then left untouched.
 */
export async function _DeprovisionByokKey(opts: DeprovisionByokKeyOptions): Promise<void>
{
  await _clearProviderKeySecret(opts.coreApi, opts.operatorNamespace, opts.provider);
  await _DeleteLiteLlmCredential(_byokCredentialName(opts.provider));
  const projectionPrisma: Prisma.TransactionClient = opts.prisma;
  const credentialProjection = new PrismaGlobalProviderCredentialProjectionRepository(projectionPrisma);
  await credentialProjection.deleteGlobal(opts.provider);
}

/**
 * Write (create-or-replace) the provider's raw key into a k8s Secret in the operator's namespace.
 * Reads first to carry `resourceVersion` on replace (PUT requires it); a 404 read falls through to
 * a create. The Secret is the durable source of truth — it survives a LiteLLM DB reset.
 */
async function _applyProviderKeySecret(coreApi: k8s.CoreV1Api, namespace: string, provider: string, apiKey: string): Promise<void>
{
  const name = _byokSecretName(provider);
  const body: k8s.V1Secret = {
    apiVersion: "v1",
    kind: "Secret",
    metadata: {
      name,
      namespace,
      labels: {
        "app.kubernetes.io/managed-by": "opencrane-server",
        "opencrane.io/byok-provider": provider,
      },
    },
    type: "Opaque",
    data: { apiKey: Buffer.from(apiKey).toString("base64") },
  };

  try
  {
    const existing = await coreApi.readNamespacedSecret({ name, namespace });
    body.metadata!.resourceVersion = existing.metadata?.resourceVersion;
    await coreApi.replaceNamespacedSecret({ name, namespace, body });
  }
  catch (err)
  {
    if (_k8sStatus(err) !== 404)
    {
      throw err;
    }
    await coreApi.createNamespacedSecret({ namespace, body });
  }
}

/** Blank a provider Secret's value while keeping the object itself — the server's Role may update these fixed names but not create or delete them, so deleting it would make the provider unrecoverable. */
async function _clearProviderKeySecret(coreApi: k8s.CoreV1Api, namespace: string, provider: string): Promise<void>
{
  try
  {
    const name = _byokSecretName(provider);
    const existing = await coreApi.readNamespacedSecret({ name, namespace });
    await coreApi.replaceNamespacedSecret({
      name,
      namespace,
      body: { ...existing, data: { apiKey: Buffer.from("").toString("base64") } },
    });
  }
  catch (err)
  {
    if (_k8sStatus(err) === 404)
    {
      throw new Error(`Provider custody Secret '${_byokSecretName(provider)}' is missing; deployment must pre-create the fixed provider catalogue`);
    }
    throw err;
  }
}

/** Extract a Kubernetes API status code from the common client error shapes. */
function _k8sStatus(err: unknown): number | undefined
{
  if (typeof err !== "object" || err === null)
  {
    return undefined;
  }
  const e = err as { statusCode?: unknown; code?: unknown; body?: { code?: unknown } };
  if (typeof e.statusCode === "number") { return e.statusCode; }
  if (typeof e.code === "number") { return e.code; }
  if (e.body && typeof e.body.code === "number") { return e.body.code; }
  return undefined;
}
