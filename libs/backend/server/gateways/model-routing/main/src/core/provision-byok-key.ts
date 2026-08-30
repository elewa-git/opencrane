import { Buffer } from "node:buffer";

import * as k8s from "@kubernetes/client-node";
import type { Logger } from "pino";
import { Prisma, type ModelDefinition as PrismaModelDefinition, type ProviderCredential as PrismaProviderCredential } from "@prisma/client";

import { ModelRoutingScope } from "@opencrane/contracts";
import { _DeleteLiteLlmCredential, _UpsertLiteLlmCredential } from "./litellm-credential-registration";
import { LiteLlmCredentialMutationOutcomes } from "./litellm-credential-registration.types";
import { _RequireLiteLlmModelDeployment } from "./litellm-model-inventory";
import { _RegisterLiteLlmModel } from "./litellm-model-registration";
import { _BYOK_PROVIDER_CATALOG } from "./byok-default-models";
import type { ByokProviderCatalog } from "./byok-default-models.types";
import { _EnsureProviderEmbeddingModels } from "./provider-embedding-models";
import type { DeprovisionByokKeyOptions, DeprovisionByokKeyResult, ProviderProvisioningPrisma, ProvisionByokKeyOptions, ProvisionByokKeyResult } from "./provision-byok-key.types";

export { _AUTO_EMBEDDING_MODEL_NAME } from "./provider-embedding-models";

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
 * Public model name of the stable "auto" selection. Backed by the cheapest catalogued model today
 * (LiteLLM has no capability-aware routing); the AIR router can re-point it later without
 * callers/skills re-selecting. See `_ensureProviderModels` step 3.
 */
const _AUTO_MODEL_NAME = "auto";

/**
 * Build the name of the Kubernetes Secret that holds a provider's raw BYOK key.
 *
 * The name is fixed per provider, and that is a security constraint rather than a convenience: the
 * server's Role grants it `get`/`update` on exactly these Secret names, so the server can rewrite
 * a key it already has but cannot invent new Secret names or delete existing ones. Deployment
 * pre-creates every Secret in the fixed provider catalogue — see `_ClearProviderKeySecret`, which
 * blanks the value instead of deleting the object.
 *
 * Called by: `_ProvisionByokKey`, `_DeprovisionByokKey`, `_ApplyProviderKeySecret` and
 * `_ClearProviderKeySecret` in this file.
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
 * (libs/backend/server/gateways/providers/main/src/routes/provider-byok.ts, centrally admitted), and
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
  await _ApplyProviderKeySecret(coreApi, operatorNamespace, provider, apiKey);

  // 2. Best-effort push to LiteLLM's /credentials dynamic path; Secret-only when unconfigured/down.
  //    custom_llm_provider is the catalog's litellmProvider (glm ⇒ zai), falling back to the key.
  const credentialName = _byokCredentialName(provider);
  const credentialOutcome = await _UpsertLiteLlmCredential({ credentialName, provider: catalog?.litellmProvider ?? provider, apiKey });
  const litellmRegistered = credentialOutcome === LiteLlmCredentialMutationOutcomes.Applied;

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
    await _EnsureProviderEmbeddingModels(catalog, litellmCredentialName, log);
  }
  catch (err)
  {
    if (requireLiveModels) throw err;
    log.warn({ provider, err }, "byok embedding model registration failed; key is set but no embedding model was registered");
  }

  return { litellmRegistered, litellmOutcomeCertain: credentialOutcome !== LiteLlmCredentialMutationOutcomes.Uncertain, row };
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
 * Called by: the centrally admitted `DELETE /:provider` handler in `providerByokRouter`.
 *
 * @param opts.prisma            - Prisma client.
 * @param opts.coreApi           - Kubernetes Core V1 API.
 * @param opts.operatorNamespace - The operator's own namespace.
 * @param opts.provider          - The provider whose key to remove.
 * @throws Error when the provider's Secret is missing entirely, which means deployment never
 *         pre-created it; the LiteLLM credential and the row are then left untouched.
 */
export async function _DeprovisionByokKey(opts: DeprovisionByokKeyOptions): Promise<DeprovisionByokKeyResult>
{
  await _ClearProviderKeySecret(opts.coreApi, opts.operatorNamespace, opts.provider);
  const credentialOutcome = await _DeleteLiteLlmCredential(_byokCredentialName(opts.provider));
  await opts.prisma.providerCredential.deleteMany({ where: { scope: "Global", clusterTenant: null, provider: opts.provider } });
  return { litellmOutcomeCertain: credentialOutcome !== LiteLlmCredentialMutationOutcomes.Uncertain };
}

/**
 * Write (create-or-replace) the provider's raw key into a k8s Secret in the operator's namespace.
 * Reads first to carry `resourceVersion` on replace (PUT requires it); a 404 read falls through to
 * a create. The Secret is the durable source of truth — it survives a LiteLLM DB reset.
 */
export async function _ApplyProviderKeySecret(coreApi: k8s.CoreV1Api, namespace: string, provider: string, apiKey: string): Promise<void>
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
export async function _ClearProviderKeySecret(coreApi: k8s.CoreV1Api, namespace: string, provider: string): Promise<void>
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
async function _upsertCredentialRow(prisma: ProviderProvisioningPrisma, provider: string, secretRef: string, litellmCredentialName: string | null): Promise<PrismaProviderCredential>
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
 * When `requireLiveModels` is true (the boot path), a referenced or non-placeholder definition
 * must retain its exact LiteLLM deployment registration. An unreferenced placeholder may be
 * registered and updated before any agent revision freezes it as execution evidence.
 *
 * @param catalog - The provider's catalogue; undefined for an uncatalogued provider, which is a
 *                  no-op — the key is still set, it just seeds no models.
 * @throws Whatever `_RegisterLiteLlmModel` throws under `requireLiveModels`; `_ProvisionByokKey`
 *         re-throws it at boot and only logs a warning otherwise.
 */
async function _ensureProviderModels(prisma: ProviderProvisioningPrisma, catalog: ByokProviderCatalog | undefined, providerCredentialId: string, litellmCredentialName: string | null, requireLiveModels: boolean): Promise<void>
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
      if (model.providerCredentialId !== providerCredentialId)
      {
        if (requireLiveModels)
        {
          throw new Error(`Existing model '${entry.slug}' is bound to a different provider credential`);
        }
        model = await _updateModelDefinition(prisma, model.id, { providerCredentialId });
      }
      if (requireLiveModels)
      {
        model = await _qualifyOrReconcileModelDefinition(prisma, model, entry.slug, litellmCredentialName);
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

  // 2. Preserve the first selected default and publish its public name through the routing
  // authority that onboarding and later run admission consume.
  if (defaultModelId)
  {
    const selectedDefaults = await prisma.modelDefinition.findMany({ where: { scope: "Global", clusterTenant: null, isDefault: true }, orderBy: { id: "asc" }, take: 2 });
    if (selectedDefaults.length > 1) throw new Error("Global model catalogue contains more than one default");
    let selectedDefault = selectedDefaults[0] ?? null;
    if (!selectedDefault)
    {
      selectedDefault = await _updateModelDefinition(prisma, defaultModelId, { isDefault: true });
    }
    await _ensureGlobalRoutingDefault(prisma, selectedDefault.publicModelName);
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
    await _qualifyOrReconcileModelDefinition(prisma, existingAuto, cheapest.slug, litellmCredentialName);
  }
}

/**
 * Verifies a referenced definition or repairs one unreferenced placeholder definition.
 *
 * Called by: strict initial-provider bootstrap for catalogue models and the stable auto alias.
 *
 * @param prisma - Model and revision authority.
 * @param model - Existing definition whose deployment must be live before startup continues.
 * @param upstreamModel - Upstream model used only when a mutable placeholder needs registration.
 * @param litellmCredentialName - Dynamic LiteLLM credential bound to a repaired deployment.
 * @returns The unchanged qualified definition, or the repaired unreferenced definition.
 * @throws When referenced evidence is absent from LiteLLM or any qualification step fails.
 */
async function _qualifyOrReconcileModelDefinition(prisma: ProviderProvisioningPrisma, model: PrismaModelDefinition, upstreamModel: string, litellmCredentialName: string | null): Promise<PrismaModelDefinition>
{
  const referenced = await prisma.agentRevision.findFirst({ where: { modelDefinitionId: model.id }, select: { id: true } });
  if (referenced || !model.litellmModelId.startsWith("placeholder:"))
  {
    await _RequireLiteLlmModelDeployment(model.publicModelName, model.litellmModelId);
    return model;
  }
  const litellmModelId = await _RegisterLiteLlmModel({ publicModelName: model.publicModelName, upstreamModel, scope: ModelRoutingScope.Global, clusterTenant: null, apiBase: model.apiBase, apiKeyEnvRef: null, litellmCredentialName, requireLiveRegistration: true });
  return _updateModelDefinition(prisma, model.id, { litellmModelId });
}

/**
 * Seeds the first Global routing default without replacing an operator's configured row.
 *
 * The partial database index admits one row whose tenant is null. A concurrent provider setup may
 * still win between the read and create, so this helper accepts only a confirmed `P2002` winner.
 */
async function _ensureGlobalRoutingDefault(prisma: ProviderProvisioningPrisma, publicModelName: string): Promise<void>
{
  const where = { scope: "Global" as const, clusterTenant: null };
  if (await prisma.modelRoutingDefault.findFirst({ where })) return;
  try
  {
    await prisma.modelRoutingDefault.create({ data: { ...where, defaultModel: publicModelName } });
  }
  catch (error)
  {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
    if (!await prisma.modelRoutingDefault.findFirst({ where })) throw error;
  }
}

/** Apply a narrow mutable ModelDefinition reconciliation patch through the existing Prisma authority. */
async function _updateModelDefinition(prisma: ProviderProvisioningPrisma, id: string, data: { providerCredentialId?: string; litellmModelId?: string; isDefault?: boolean })
{
  return prisma.modelDefinition.update({ where: { id }, data });
}
