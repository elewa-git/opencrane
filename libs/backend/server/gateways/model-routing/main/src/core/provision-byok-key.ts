import { Buffer } from "node:buffer";

import * as k8s from "@kubernetes/client-node";
import type { Logger } from "pino";
import type { PrismaClient, ProviderCredential as PrismaProviderCredential } from "@prisma/client";

import { ModelRoutingScope } from "@opencrane/contracts";
import { _DeleteLiteLlmCredential, _UpsertLiteLlmCredential } from "./litellm-credential-registration.js";
import { _RegisterLiteLlmModel } from "./litellm-model-registration.js";
import { _BYOK_PROVIDER_CATALOG } from "./byok-default-models.js";
import type { ByokProviderCatalog } from "./byok-default-models.types.js";
import type { DeprovisionByokKeyOptions, ProvisionByokKeyOptions, ProvisionByokKeyResult } from "./provision-byok-key.types.js";

/**
 * Reusable core for setting/removing a silo's BYOK provider key — the work behind both the HTTP
 * route (`providerByokRouter`) and the boot-time bootstrap. Writing it here (not in `routes/`) keeps
 * the provisioning logic out of the HTTP layer so the operator boot path can call it directly.
 *
 * A set: write the raw key to a k8s Secret (durable source of truth) → push to LiteLLM's
 * `/credentials` dynamic path (best-effort) → upsert the Global ProviderCredential row → seed a
 * default model bound to it. A key is Global-scoped (silo-wide), never per openclaw tenant.
 */

/**
 * Public model name of the stable "auto" selection. Backed by the cheapest catalogued model
 * today (LiteLLM has no capability-aware routing); the AIR router can re-point it later without
 * callers/skills re-selecting. See `_ensureProviderModels` step 3.
 */
const _AUTO_MODEL_NAME = "auto";

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

/** Name of the k8s Secret carrying a provider's raw BYOK key, in the operator's own namespace. */
export function _byokSecretName(provider: string): string
{
  return `byok-provider-key-${provider}`;
}

/** Name of the LiteLLM `/credentials` entry for a provider's BYOK key. */
export function _byokCredentialName(provider: string): string
{
  return `byok-${provider}`;
}

/**
 * Provision (set or refresh) a silo's raw BYOK key for a provider: persist the Secret, register the
 * LiteLLM credential, record the ProviderCredential row, and seed a default model bound to it.
 *
 * @param opts.prisma            - Prisma client for the credential + model rows.
 * @param opts.coreApi           - Kubernetes Core V1 API for the Secret write.
 * @param opts.operatorNamespace - The operator's own namespace (where the silo's keys live).
 * @param opts.provider          - The provider the key is for (e.g. `openai`).
 * @param opts.apiKey            - The raw upstream key (never logged or echoed).
 * @param opts.log               - Scoped logger for the best-effort model-seed warning.
 * @returns Whether LiteLLM accepted the key, and the upserted credential row.
 */
export async function _ProvisionByokKey(opts: ProvisionByokKeyOptions): Promise<ProvisionByokKeyResult>
{
  const { prisma, coreApi, operatorNamespace, provider, apiKey, log } = opts;
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
    await _ensureProviderModels(prisma, catalog, row.id, litellmCredentialName);
  }
  catch (err)
  {
    log.warn({ provider, err }, "byok model seed failed; key is set but its models were not seeded");
  }

  // 5. Best-effort: register the provider's embedding model (if catalogued) directly with LiteLLM —
  //    deliberately OUTSIDE step 4's ModelDefinition path (see ByokProviderCatalog.embeddingModel).
  try
  {
    await _ensureProviderEmbeddingModel(catalog, litellmCredentialName, log);
  }
  catch (err)
  {
    log.warn({ provider, err }, "byok embedding model registration failed; key is set but no embedding model was registered");
  }

  return { litellmRegistered, row };
}

/**
 * Remove a silo's BYOK key for a provider: delete the Secret, the LiteLLM credential, and the row.
 *
 * @param opts.prisma            - Prisma client.
 * @param opts.coreApi           - Kubernetes Core V1 API.
 * @param opts.operatorNamespace - The operator's own namespace.
 * @param opts.provider          - The provider whose key to remove.
 */
export async function _DeprovisionByokKey(opts: DeprovisionByokKeyOptions): Promise<void>
{
  await _deleteProviderKeySecret(opts.coreApi, opts.operatorNamespace, opts.provider);
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

/** Best-effort delete of the provider's key Secret, treating 404 (already gone) as success. */
async function _deleteProviderKeySecret(coreApi: k8s.CoreV1Api, namespace: string, provider: string): Promise<void>
{
  try
  {
    await coreApi.deleteNamespacedSecret({ name: _byokSecretName(provider), namespace });
  }
  catch (err)
  {
    if (_k8sStatus(err) !== 404)
    {
      throw err;
    }
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
 * Best-effort: register EVERY model class in a provider's catalog, all Global-scoped and bound to
 * the provider's SINGLE credential, so the pod's `main` agent resolves to a `litellm-proxy` model
 * and LiteLLM can switch across the provider's tiers on the one key. The rows are surfaced by the
 * tenant-models endpoint into the pod config.
 *
 * Non-destructive: an existing Global row for a slug is reused (re-bound to this credential rather
 * than duplicated). The silo default is claimed by the catalog's `defaultClass` model only when no
 * Global model is default yet — the first provider configured wins, and an existing default (here
 * or a higher-precedence routing default) is never stolen.
 *
 * @param prisma                - Prisma client.
 * @param catalog               - The provider's catalog, or undefined (provider not catalogued ⇒ no-op).
 * @param providerCredentialId  - The single ProviderCredential id every class binds to.
 * @param litellmCredentialName - The LiteLLM credential name (null ⇒ Secret-only; models register
 *                                without a key binding and reconcile when LiteLLM is reachable).
 */
async function _ensureProviderModels(prisma: PrismaClient, catalog: ByokProviderCatalog | undefined, providerCredentialId: string, litellmCredentialName: string | null): Promise<void>
{
  if (!catalog)
  {
    return;
  }

  // 1. Find or register each class's Global model deployment, all bound to the ONE credential.
  let defaultModelId: string | null = null;
  for (const entry of catalog.models)
  {
    let model = await prisma.modelDefinition.findFirst({ where: { scope: "Global", clusterTenant: null, publicModelName: entry.slug } });
    if (model)
    {
      if (model.providerCredentialId !== providerCredentialId)
      {
        model = await prisma.modelDefinition.update({ where: { id: model.id }, data: { providerCredentialId } });
      }
    }
    else
    {
      const litellmModelId = await _RegisterLiteLlmModel({
        publicModelName: entry.slug,
        upstreamModel: entry.slug,
        scope: ModelRoutingScope.Global,
        clusterTenant: null,
        apiBase: null,
        apiKeyEnvRef: null,
        litellmCredentialName,
      });
      model = await prisma.modelDefinition.create({
        data: { scope: "Global", clusterTenant: null, publicModelName: entry.slug, litellmModelId, upstreamModel: entry.slug, apiBase: null, isDefault: false, providerCredentialId },
      });
    }
    if (entry.className === catalog.defaultClass)
    {
      defaultModelId = model.id;
    }
  }

  // 2. Claim the silo default with the provider's default-class model, only when nothing is default
  //    yet — first provider configured wins; never steal an existing default.
  if (defaultModelId)
  {
    const hasDefault = await prisma.modelDefinition.findFirst({ where: { scope: "Global", clusterTenant: null, isDefault: true } });
    if (!hasDefault)
    {
      await prisma.modelDefinition.update({ where: { id: defaultModelId }, data: { isDefault: true } });
    }
  }

  // 3. Register the "auto" model — a STABLE selection id, so a caller/skill can pick "auto" once
  //    and its backing model can improve later without re-selecting. Backed today by the provider's
  //    CHEAPEST (`fast`-class) model: LiteLLM has no capability-aware routing (it is static/reactive
  //    — cost/latency/shuffle only), so native "auto" deterministically resolves to the cheapest
  //    deployment. The intelligent cost/quality router (RouteLLM + measurement, AIR track) can later
  //    re-point this same "auto" id without any caller change. Registered ONCE (first provider wins).
  //    @todo - Do smart via RouteLLM & LangFuse
  const cheapest = catalog.models.find((m) => m.className === "fast") ?? catalog.models[catalog.models.length - 1];
  if (cheapest)
  {
    const existingAuto = await prisma.modelDefinition.findFirst({ where: { scope: "Global", clusterTenant: null, publicModelName: _AUTO_MODEL_NAME } });
    if (!existingAuto)
    {
      const litellmModelId = await _RegisterLiteLlmModel({
        publicModelName: _AUTO_MODEL_NAME,
        upstreamModel: cheapest.slug,
        scope: ModelRoutingScope.Global,
        clusterTenant: null,
        apiBase: null,
        apiKeyEnvRef: null,
        litellmCredentialName,
      });
      await prisma.modelDefinition.create({
        data: { scope: "Global", clusterTenant: null, publicModelName: _AUTO_MODEL_NAME, litellmModelId, upstreamModel: cheapest.slug, apiBase: null, isDefault: false, providerCredentialId },
      });
    }
  }
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
async function _ensureProviderEmbeddingModel(catalog: ByokProviderCatalog | undefined, litellmCredentialName: string | null, log: Logger): Promise<void>
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
    if (registered.has(deployment.publicModelName))
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
    const info = await response.json() as { data?: Array<{ model_name?: string }> };
    return new Set((info.data ?? []).map(function _name(m) { return m.model_name ?? ""; }).filter(Boolean));
  }
  catch
  {
    return new Set();
  }
}
