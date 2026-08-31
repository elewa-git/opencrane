import { ModelRoutingScope } from "@opencrane/contracts";
import type { ByokProviderCatalog } from "./byok-default-models.types";
import { _RequireLiteLlmModelDeployment } from "./litellm-model-inventory";
import { _RegisterLiteLlmModel } from "./litellm-model-registration";
import type { ProviderModelBootstrapRepositories } from "./provider-model-bootstrap.types";
import type { ProviderModelDefinition } from "./provider-model-evidence-repository.types";

/** Public model name of the stable, provider-backed automatic selection. */
const _AUTO_MODEL_NAME = "auto";

/**
 * Validates a coordinator-selected model before the raw key or any durable row is changed.
 *
 * The deployment coordinator owns registry admission. This boundary still proves the selected
 * model belongs to the provider credential it is about to bind, including GLM's `zai` LiteLLM
 * namespace, so a mismatched model can never consume another provider's key.
 *
 * Called by: `_ProvisionByokKey` before it writes the provider key Secret.
 *
 * @param provider - Provider whose credential will be bound.
 * @param catalog - Reviewed provider catalogue, when the provider has one.
 * @param selectedModel - Provider-prefixed model selected by the deployment coordinator.
 * @param requireLiveModels - Whether bootstrap must register models through live LiteLLM.
 * @throws When the selected model does not belong to the provider or live registration is disabled.
 */
export function _ValidateBootstrapModel(provider: string, catalog: ByokProviderCatalog | undefined, selectedModel: string | undefined, requireLiveModels: boolean): void
{
  if (selectedModel === undefined)
  {
    return;
  }
  if (!requireLiveModels)
  {
    throw new Error("A selected bootstrap model requires live model registration");
  }
  const namespace = catalog?.litellmProvider ?? provider;
  const prefix = `${namespace}/`;
  if (selectedModel !== selectedModel.trim() || !selectedModel.startsWith(prefix) || selectedModel.length === prefix.length)
  {
    throw new Error(`Selected model '${selectedModel}' does not belong to provider '${provider}' LiteLLM namespace '${namespace}'`);
  }
}

/**
 * Makes every catalogued model class available and admits an exact bootstrap model when supplied.
 *
 * Each class gets one Global model row bound to the provider credential. The first selected
 * default remains authoritative, so adding another provider cannot replace an operator's choice.
 * The stable `auto` alias follows the provider's cheapest class. A bootstrap model that is newer
 * than the static production catalogue passes through the same live-registration authority.
 *
 * When `requireLiveModels` is true, referenced or non-placeholder definitions must retain their
 * exact LiteLLM deployment registration. An unreferenced placeholder may be registered and
 * updated before any agent revision freezes it as execution evidence.
 *
 * Called by: `_ProvisionByokKey` after it has stored the provider credential.
 *
 * @param repositories - Stores the provider credential's models and first routing default.
 * @param catalog - Provider catalogue; undefined is a no-op unless a selected model is supplied.
 * @param providerCredentialId - Credential projection that every admitted model will reference.
 * @param litellmCredentialName - LiteLLM credential name already published by the custody boundary.
 * @param requireLiveModels - Whether every model must retain a live LiteLLM deployment.
 * @param selectedModel - Exact provider-prefixed model selected by the deployment coordinator.
 * @returns Resolves after the model definitions and first routing default are reconciled.
 * @throws When existing routing evidence conflicts, the Global default is ambiguous, or live LiteLLM qualification fails.
 */
export async function _EnsureProviderModels(repositories: ProviderModelBootstrapRepositories, catalog: ByokProviderCatalog | undefined, providerCredentialId: string, litellmCredentialName: string | null, requireLiveModels: boolean, selectedModel?: string): Promise<void>
{
  let catalogDefaultModelId: string | null = null;
  let selectedModelId: string | null = null;
  const catalogDefaultClass = catalog?.defaultClass;
  for (const entry of catalog?.models ?? [])
  {
    let model = await repositories.models.findGlobalByPublicName(entry.slug);
    if (model)
    {
      if (model.providerCredentialId !== providerCredentialId)
      {
        if (requireLiveModels)
        {
          throw new Error(`Existing model '${entry.slug}' is bound to a different provider credential`);
        }
        model = await repositories.models.update(model.id, { providerCredentialId });
      }
      if (requireLiveModels)
      {
        model = await _qualifyOrReconcileModelDefinition(repositories.models, model, entry.slug, litellmCredentialName);
      }
    }
    else
    {
      const litellmModelId = await _RegisterLiteLlmModel({ publicModelName: entry.slug, upstreamModel: entry.slug, scope: ModelRoutingScope.Global, clusterTenant: null, apiBase: null, apiKeyEnvRef: null, litellmCredentialName, requireLiveRegistration: requireLiveModels });
      model = await repositories.models.createGlobal({
        publicModelName: entry.slug,
        litellmModelId,
        upstreamModel: entry.slug,
        apiBase: null,
        isDefault: false,
        providerCredentialId,
      });
    }
    if (entry.className === catalogDefaultClass)
    {
      catalogDefaultModelId = model.id;
    }
    if (entry.slug === selectedModel)
    {
      selectedModelId = model.id;
    }
  }

  if (selectedModel && !selectedModelId)
  {
    selectedModelId = await _ensureSelectedModel(repositories.models, selectedModel, providerCredentialId, litellmCredentialName);
  }

  const defaultModelId = selectedModelId ?? catalogDefaultModelId;
  if (defaultModelId)
  {
    const selectedDefaults = await repositories.models.listGlobalDefaults();
    if (selectedDefaults.length > 1)
    {
      throw new Error("Global model catalogue contains more than one default");
    }
    let selectedDefault = selectedDefaults[0] ?? null;
    if (!selectedDefault)
    {
      selectedDefault = await repositories.models.update(defaultModelId, { isDefault: true });
    }
    await repositories.routingDefaults.ensureFirst(selectedDefault.publicModelName);
  }

  const cheapest = catalog?.models.find((model) => model.className === "fast") ?? catalog?.models[catalog.models.length - 1];
  if (!cheapest)
  {
    return;
  }
  const existingAuto = await repositories.models.findGlobalByPublicName(_AUTO_MODEL_NAME);
  if (!existingAuto)
  {
    const litellmModelId = await _RegisterLiteLlmModel({ publicModelName: _AUTO_MODEL_NAME, upstreamModel: cheapest.slug, scope: ModelRoutingScope.Global, clusterTenant: null, apiBase: null, apiKeyEnvRef: null, litellmCredentialName, requireLiveRegistration: requireLiveModels });
    await repositories.models.createGlobal({
      publicModelName: _AUTO_MODEL_NAME,
      litellmModelId,
      upstreamModel: cheapest.slug,
      apiBase: null,
      isDefault: false,
      providerCredentialId,
    });
    return;
  }
  if (requireLiveModels)
  {
    await _qualifyOrReconcileModelDefinition(repositories.models, existingAuto, cheapest.slug, litellmCredentialName);
  }
}

/** Registers one reviewed bootstrap model that may be newer than the production class catalogue. */
async function _ensureSelectedModel(models: ProviderModelBootstrapRepositories["models"], selectedModel: string, providerCredentialId: string, litellmCredentialName: string | null): Promise<string>
{
  const existing = await models.findGlobalByPublicName(selectedModel);
  if (existing)
  {
    if (existing.providerCredentialId !== providerCredentialId)
    {
      throw new Error(`Existing model '${selectedModel}' is bound to a different provider credential`);
    }
    const qualified = await _qualifyOrReconcileModelDefinition(models, existing, selectedModel, litellmCredentialName);
    return qualified.id;
  }
  const litellmModelId = await _RegisterLiteLlmModel({
    publicModelName: selectedModel,
    upstreamModel: selectedModel,
    scope: ModelRoutingScope.Global,
    clusterTenant: null,
    apiBase: null,
    apiKeyEnvRef: null,
    litellmCredentialName,
    requireLiveRegistration: true,
  });
  const created = await models.createGlobal({
    publicModelName: selectedModel,
    litellmModelId,
    upstreamModel: selectedModel,
    apiBase: null,
    isDefault: false,
    providerCredentialId,
  });
  return created.id;
}

/**
 * Verifies a referenced definition or repairs one unreferenced placeholder definition.
 *
 * Referenced evidence and established deployments retain their exact LiteLLM deployment id.
 * Only a placeholder with no revision reference may acquire a new live registration.
 */
async function _qualifyOrReconcileModelDefinition(models: ProviderModelBootstrapRepositories["models"], model: ProviderModelDefinition, upstreamModel: string, litellmCredentialName: string | null): Promise<ProviderModelDefinition>
{
  const referenced = await models.isReferencedByAgentRevision(model.id);
  if (referenced || !model.litellmModelId.startsWith("placeholder:"))
  {
    await _RequireLiteLlmModelDeployment(model.publicModelName, model.litellmModelId);
    return model;
  }
  const litellmModelId = await _RegisterLiteLlmModel({ publicModelName: model.publicModelName, upstreamModel, scope: ModelRoutingScope.Global, clusterTenant: null, apiBase: model.apiBase, apiKeyEnvRef: null, litellmCredentialName, requireLiveRegistration: true });
  return models.update(model.id, { litellmModelId });
}
