import { Buffer } from "node:buffer";

import * as k8s from "@kubernetes/client-node";
import type { Logger } from "pino";
import type { PrismaClient, ProviderCredential as PrismaProviderCredential } from "@prisma/client";

import { ___DoWithTrace } from "@opencrane/backend/observability";
import { ModelRoutingScope } from "@opencrane/contracts";
import { ___ParseAndValidateJson } from "@opencrane/util";
import { _DeleteLiteLlmCredential, _UpsertLiteLlmCredential } from "./litellm-credential-registration.js";
import { _RegisterLiteLlmModel } from "./litellm-model-registration.js";
import { _BYOK_PROVIDER_CATALOG } from "./byok-default-models.js";
import type { ByokProviderCatalog } from "./byok-default-models.types.js";
import type { DeprovisionByokKeyOptions, ProvisionByokKeyOptions, ProvisionByokKeyResult } from "./provision-byok-key.types.js";

/**
 * Setting and removing a silo's BYOK provider key. Both the HTTP route (`providerByokRouter`) and
 * the boot-time bootstrap call these functions, which is why they live here and not in `routes/` —
 * the boot path has no HTTP request to go through.
 *
 * Setting a key, in order: write the raw key to a Kubernetes Secret (the durable copy), push it to
 * LiteLLM's `/credentials` (best-effort), write the Global `ProviderCredential` row, then seed the
 * models bound to it. NOTE: the row this file writes is always Global (`scope: "Global"`,
 * `clusterTenant: null`) — the ClusterTenant-scoped variant is written through
 * `providerCredentialsRouter`, not here.
 */

/**
 * Public model name of the stable EMBEDDING selection — the embedding-side mirror of
 * {@link _AUTO_MODEL_NAME}. Backed by the configured provider's catalogued embedding model
 * (see `_ensureProviderEmbeddingModel`); an internal consumer (Cognee) references this stable
 * alias instead of a provider-specific slug, so the operator can re-point the backing embedding
 * model without a consumer/values edit.
 *
 * MUST equal `apps/_infra/deploy-k8s/values.yaml`'s
 * `clustertenantManager.cognee.embedding.model` (the two agree by convention — the chart cannot
 * import this constant), exactly like the `cognee-litellm-key` Secret-name agreement.
 */
export const _AUTO_EMBEDDING_MODEL_NAME = "auto-embedding";

/**
 * Public model name of the stable "auto" selection. Backed by the cheapest catalogued model today
 * (LiteLLM has no capability-aware routing); the AIR router can re-point it later without
 * callers/skills re-selecting. See `_ensureProviderModels` step 3.
 */
const _AUTO_MODEL_NAME = "auto";

/**
 * Check that LiteLLM really has a given model registered, and throw if it does not.
 *
 * Stricter than the interactive BYOK route on purpose: a fresh install must not start accepting
 * traffic until the model its default alias points at can actually be resolved by the LiteLLM
 * instance deployed alongside it. Failing loudly at boot beats every later request failing.
 *
 * Called by: apps/opencrane/src/app/initial-model-bootstrap.ts, which calls it with `"auto"`
 * after provisioning the first key.
 *
 * @param publicModelName - The LiteLLM `model_name` that must appear in `GET /model/info`.
 * @throws Error when `LITELLM_ENDPOINT` or `LITELLM_MASTER_KEY` is unset, when `/model/info`
 *         answers with a non-2xx status, when its body does not parse, or when the model is
 *         simply not in the returned inventory.
 * @see LiteLLM proxy `GET /model/info`, pinned to `main-v1.81.0-stable` by `litellm.image.tag`
 *      in apps/_infra/deploy-k8s/values.yaml — NEEDS-HUMAN: add the docs URI for that release.
 */
export async function _RequireLiteLlmModelRegistration(publicModelName: string): Promise<void>
{
  const endpoint = process.env.LITELLM_ENDPOINT?.trim() ?? "";
  const masterKey = process.env.LITELLM_MASTER_KEY?.trim() ?? "";
  if (!endpoint || !masterKey)
  {
    throw new Error("LiteLLM endpoint and master key are required to validate the initial model");
  }

  const registered = await ___DoWithTrace(
    "litellm.model.require",
    { publicModelName },
    async function _readInventory(): Promise<Set<string>>
    {
      const response = await fetch(`${endpoint}/model/info`, {
        headers: { Authorization: `Bearer ${masterKey}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok)
      {
        throw new Error(`LiteLLM model inventory returned HTTP ${response.status}`);
      }
      return ___ParseAndValidateJson(await response.text(), "LiteLLM model inventory response", _RegisteredModelNames);
    },
  );
  if (!registered.has(publicModelName))
  {
    throw new Error(`LiteLLM has not registered required model '${publicModelName}'`);
  }
}

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
 * Five steps, in this order for a reason: write the key to its Kubernetes Secret first (that
 * Secret is the durable copy and survives a LiteLLM database reset), push it to LiteLLM's
 * `/credentials`, record the `ProviderCredential` row, register every model class for the
 * provider, and finally register the provider's embedding model.
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
  const { prisma, coreApi, operatorNamespace, provider, apiKey, log, requireLiveModels = false } = opts;
  const catalog = _BYOK_PROVIDER_CATALOG[provider];

  // 1. Persist the raw key to its k8s Secret first — the durable source of truth.
  await _applyProviderKeySecret(coreApi, operatorNamespace, provider, apiKey);

  // 2. Best-effort push to LiteLLM's /credentials dynamic path; Secret-only when unconfigured/down.
  //    custom_llm_provider is the catalog's litellmProvider (glm ⇒ zai), falling back to the key.
  const credentialName = _byokCredentialName(provider);
  const litellmRegistered = await _UpsertLiteLlmCredential({ credentialName, provider: catalog?.litellmProvider ?? provider, apiKey });

  // 3. Record the credential reference (litellmCredentialName set only when LiteLLM accepted it).
  const secretRef = _byokSecretName(provider);
  const litellmCredentialName = litellmRegistered ? credentialName : null;
  const row = await _upsertCredentialRow(prisma, provider, secretRef, litellmCredentialName);

  // 4. Best-effort: register EVERY model class for the provider, all bound to this one credential,
  //    so LiteLLM can switch across tiers on the single key. Never fail the set if this trips.
  try
  {
    await _ensureProviderModels(prisma, catalog, row.id, litellmCredentialName, requireLiveModels);
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
    await _ensureProviderEmbeddingModel(catalog, litellmCredentialName, log, requireLiveModels);
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
  await opts.prisma.providerCredential.deleteMany({ where: { scope: "Global", clusterTenant: null, provider: opts.provider } });
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

/**
 * Upsert the Global-scoped {@link PrismaProviderCredential} row for a provider. findFirst →
 * update | create (not Prisma `upsert`) because the compound unique `[scope, clusterTenant, provider]`
 * carries a null `clusterTenant`. A concurrent create trips P2002 on the second writer; that is
 * caught and converged into an update so two simultaneous sets never 500.
 */
async function _upsertCredentialRow(prisma: PrismaClient, provider: string, secretRef: string, litellmCredentialName: string | null): Promise<PrismaProviderCredential>
{
  const where = { scope: "Global" as const, clusterTenant: null, provider };
  const existing = await prisma.providerCredential.findFirst({ where });
  if (existing)
  {
    return prisma.providerCredential.update({ where: { id: existing.id }, data: { secretRef, litellmCredentialName } });
  }
  try
  {
    return await prisma.providerCredential.create({ data: { ...where, secretRef, litellmCredentialName } });
  }
  catch (err)
  {
    // A concurrent create won the race — converge by updating the row it inserted.
    if ((err as { code?: unknown }).code !== "P2002")
    {
      throw err;
    }
    const raced = await prisma.providerCredential.findFirst({ where });
    if (!raced)
    {
      throw err;
    }
    return prisma.providerCredential.update({ where: { id: raced.id }, data: { secretRef, litellmCredentialName } });
  }
}

/**
 * Make sure every model class in a provider's catalogue has a Global `ModelDefinition` row, and —
 * at boot — a live LiteLLM deployment behind it.
 *
 * Three things happen. Each class gets its row created or re-pointed at this credential. The
 * first-ever default is preserved, so setting up a second provider never steals the default from
 * the first. And the stable `auto` alias is pointed at the provider's cheapest class.
 *
 * When `requireLiveModels` is true (the boot path) every registration must return a real LiteLLM
 * deployment id, and that id is written back to the row. Without that, a row created while
 * LiteLLM was unreachable would keep its placeholder id for good and never route.
 *
 * @param catalog - The provider's catalogue; undefined for an uncatalogued provider, which is a
 *                  no-op — the key is still set, it just seeds no models.
 * @throws Whatever `_RegisterLiteLlmModel` throws under `requireLiveModels`; `_ProvisionByokKey`
 *         re-throws it at boot and only logs a warning otherwise.
 */
async function _ensureProviderModels(prisma: PrismaClient, catalog: ByokProviderCatalog | undefined, providerCredentialId: string, litellmCredentialName: string | null, requireLiveModels: boolean): Promise<void>
{
  if (!catalog)
  {
    return;
  }

  // 1. Reconcile each provider class to one Global model row and, at startup, its live deployment.
  let defaultModelId: string | null = null;
  for (const entry of catalog.models)
  {
    let model = await prisma.modelDefinition.findFirst({ where: { scope: "Global", clusterTenant: null, publicModelName: entry.slug } });
    if (model)
    {
      const liveModelId = requireLiveModels
        ? await _RegisterLiteLlmModel({ publicModelName: entry.slug, upstreamModel: entry.slug, scope: ModelRoutingScope.Global, clusterTenant: null, apiBase: null, apiKeyEnvRef: null, litellmCredentialName, requireLiveRegistration: true })
        : null;
      if (model.providerCredentialId !== providerCredentialId || liveModelId !== null)
      {
        model = await _updateModelDefinition(prisma, model.id, {
            ...(model.providerCredentialId !== providerCredentialId ? { providerCredentialId } : {}),
            ...(liveModelId !== null ? { litellmModelId: liveModelId } : {}),
        });
      }
    }
    else
    {
      const litellmModelId = await _RegisterLiteLlmModel({ publicModelName: entry.slug, upstreamModel: entry.slug, scope: ModelRoutingScope.Global, clusterTenant: null, apiBase: null, apiKeyEnvRef: null, litellmCredentialName, requireLiveRegistration: requireLiveModels });
      model = await prisma.modelDefinition.create({ data: { scope: "Global", clusterTenant: null, publicModelName: entry.slug, litellmModelId, upstreamModel: entry.slug, apiBase: null, isDefault: false, providerCredentialId } });
    }
    if (entry.className === catalog.defaultClass)
    {
      defaultModelId = model.id;
    }
  }

  // 2. Preserve the first selected default; a newly provisioned provider never steals it.
  if (defaultModelId)
  {
    const hasDefault = await prisma.modelDefinition.findFirst({ where: { scope: "Global", clusterTenant: null, isDefault: true } });
    if (!hasDefault)
    {
      await _updateModelDefinition(prisma, defaultModelId, { isDefault: true });
    }
  }

  // 3. Reconcile the stable auto alias to the cheapest provider class without changing caller input.
  const cheapest = catalog.models.find((model) => model.className === "fast") ?? catalog.models[catalog.models.length - 1];
  if (!cheapest)
  {
    return;
  }
  const existingAuto = await prisma.modelDefinition.findFirst({ where: { scope: "Global", clusterTenant: null, publicModelName: _AUTO_MODEL_NAME } });
  if (!existingAuto)
  {
    const litellmModelId = await _RegisterLiteLlmModel({ publicModelName: _AUTO_MODEL_NAME, upstreamModel: cheapest.slug, scope: ModelRoutingScope.Global, clusterTenant: null, apiBase: null, apiKeyEnvRef: null, litellmCredentialName, requireLiveRegistration: requireLiveModels });
    await prisma.modelDefinition.create({ data: { scope: "Global", clusterTenant: null, publicModelName: _AUTO_MODEL_NAME, litellmModelId, upstreamModel: cheapest.slug, apiBase: null, isDefault: false, providerCredentialId } });
    return;
  }
  if (requireLiveModels)
  {
    const litellmModelId = await _RegisterLiteLlmModel({ publicModelName: _AUTO_MODEL_NAME, upstreamModel: cheapest.slug, scope: ModelRoutingScope.Global, clusterTenant: null, apiBase: null, apiKeyEnvRef: null, litellmCredentialName, requireLiveRegistration: true });
    await _updateModelDefinition(prisma, existingAuto.id, { litellmModelId });
  }
}

/** Apply a narrow ModelDefinition reconciliation patch through the existing Prisma authority. */
async function _updateModelDefinition(prisma: PrismaClient, id: string, data: { providerCredentialId?: string; litellmModelId?: string; isDefault?: boolean })
{
  return prisma.modelDefinition.update({ where: { id }, data });
}

/**
 * Best-effort, idempotent registration of a provider's embedding model directly with LiteLLM —
 * deliberately WITHOUT a `ModelDefinition` row (see `ByokProviderCatalog.embeddingModel`'s doc:
 * every Global `ModelDefinition` is exposed to EVERY tenant as a selectable chat model, so an
 * embedding deployment must never become one). No-op when the provider has no catalogued
 * embedding model, or when LiteLLM is unconfigured (dev/tests — mirrors `_RegisterLiteLlmModel`'s
 * own guard).
 *
 * Idempotency is checked directly against LiteLLM (`GET /model/info`) rather than a local
 * bookkeeping row, since intentionally skipping `ModelDefinition` here means there is no row to
 * check against; a read failure falls through to attempting registration anyway (LiteLLM's own
 * `/model/new` on an existing `model_name` is itself safe to repeat).
 *
 * @param catalog               - The provider's catalog, or undefined (provider not catalogued).
 * @param litellmCredentialName - The LiteLLM credential name (null ⇒ Secret-only baseline).
 * @param log                   - Scoped logger for the registration outcome.
 */
async function _ensureProviderEmbeddingModel(catalog: ByokProviderCatalog | undefined, litellmCredentialName: string | null, log: Logger, requireLiveModels: boolean): Promise<void>
{
  if (!catalog?.embeddingModel)
  {
    return;
  }

  const endpoint = process.env.LITELLM_ENDPOINT?.trim() ?? "";
  const masterKey = process.env.LITELLM_MASTER_KEY?.trim() ?? "";
  if (!endpoint || !masterKey)
  {
    return;
  }

  const slug = catalog.embeddingModel.slug;

  // Register TWO embedding deployments, both GLOBAL, both explicitly `mode: "embedding"` so
  // LiteLLM's `/embeddings` route resolves them, and both WITHOUT a ModelDefinition row (see
  // ByokProviderCatalog.embeddingModel — an embedding deployment must never surface as a
  // tenant-selectable chat model):
  //   1. the provider's real embedding model under its own slug; and
  //   2. the stable `auto-embedding` alias (_AUTO_EMBEDDING_MODEL_NAME) pointing at that same
  //      upstream — the embedding-side mirror of the chat `auto` selection. Cognee references
  //      the alias, so its backing model can be re-pointed here without a Cognee/values edit.
  // First-wins across providers: the alias resolves to whichever provider's embedding model is
  // registered first, and the /model/info check below skips it thereafter — two different-provider
  // embedding models must never both answer to `auto-embedding` (incompatible vector spaces).
  const deployments = [
    { publicModelName: slug, upstreamModel: slug },
    { publicModelName: _AUTO_EMBEDDING_MODEL_NAME, upstreamModel: slug },
  ];

  // Best-effort idempotency: read the already-registered model names ONCE. Any failure here
  // (network, non-2xx, bad JSON) yields an empty set, so registration is simply attempted —
  // LiteLLM's own `/model/new` on an existing `model_name` is itself safe to repeat.
  const registered = await _litellmRegisteredModelNames(endpoint, masterKey);

  for (const deployment of deployments)
  {
    if (registered.has(deployment.publicModelName) && !requireLiveModels)
    {
      log.debug({ publicModelName: deployment.publicModelName }, "embedding model already registered with litellm");
      continue;
    }

    await _RegisterLiteLlmModel({
      publicModelName: deployment.publicModelName,
      upstreamModel: deployment.upstreamModel,
      scope: ModelRoutingScope.Global,
      clusterTenant: null,
      apiBase: null,
      apiKeyEnvRef: null,
      litellmCredentialName,
      mode: "embedding",
      requireLiveRegistration: requireLiveModels,
    });
    log.info({ publicModelName: deployment.publicModelName, upstreamModel: deployment.upstreamModel }, "embedding model registered with litellm");
  }
}

/**
 * Best-effort read of the set of `model_name`s LiteLLM already has registered (`GET /model/info`).
 * Returns an empty set on any failure (unconfigured, unreachable, non-2xx, bad JSON) so callers
 * fall through to attempting registration rather than being blocked by a transient read.
 */
async function _litellmRegisteredModelNames(endpoint: string, masterKey: string): Promise<Set<string>>
{
  try
  {
    const response = await fetch(`${endpoint}/model/info`, {
      headers: { Authorization: `Bearer ${masterKey}` },
    });
    if (!response.ok)
    {
      return new Set();
    }
    return ___ParseAndValidateJson(await response.text(), "LiteLLM model inventory response", _RegisteredModelNames);
  }
  catch
  {
    return new Set();
  }
}

/** Validate and collect the registered model names returned by LiteLLM. */
function _RegisteredModelNames(value: unknown): Set<string>
{
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("LiteLLM model inventory must be an object");
  const data = (value as Record<string, unknown>)["data"];
  if (data === undefined) return new Set();
  if (!Array.isArray(data)) throw new Error("LiteLLM model inventory data must be an array");
  const names = data.map(function _Name(entry): string
  {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) throw new Error("LiteLLM model inventory entry must be an object");
    const modelName = (entry as Record<string, unknown>)["model_name"];
    if (modelName === undefined) return "";
    if (typeof modelName !== "string") throw new Error("LiteLLM model inventory name must be a string");
    return modelName;
  });
  return new Set(names.filter(Boolean));
}
