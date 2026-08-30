import { Router } from "express";
import { GeneratedOutputCapability, ModelRoutingScope, type ModelDefinition, type ModelDefinitionWrite } from "@opencrane/contracts";
import type { Prisma, PrismaClient, ModelDefinition as PrismaModelDefinition } from "@prisma/client";

import { ProductAuthorizationActions, ProductAuthorizationResourceKinds } from "@opencrane/models/authorization";
import { _RegisterLiteLlmModel } from "@opencrane/backend/server/gateways/model-routing";

import type { ProviderGatewayAuthorizationFactory, ProviderGatewayCallerResolver } from "../provider-gateway-authority.types";
import { _GrantProviderResourceCreatorUse, _RequireProviderGatewayAdministration, _RequireProviderGatewayCaller, _ResolveProviderGatewayCaller, _SendProviderGatewayAuthorizationError } from "../provider-gateway-authorization";
import { PrismaProviderGatewayUnitOfWork } from "../prisma-provider-gateway-unit-of-work";

/**
 * Project a persisted model-definition row into its contract DTO. The Prisma enum values map
 * 1:1 to the lowercase {@link ModelRoutingScope} string union.
 *
 * @param row - The persisted `ModelDefinition` row.
 * @returns The contract-shaped model definition (timestamps as ISO-8601 strings).
 */
function _toContract(row: PrismaModelDefinition): ModelDefinition
{
  return {
    id: row.id,
    scope: row.scope === "ClusterTenant" ? ModelRoutingScope.ClusterTenant : ModelRoutingScope.Global,
    clusterTenant: row.clusterTenant,
    publicModelName: row.publicModelName,
    litellmModelId: row.litellmModelId,
    upstreamModel: row.upstreamModel,
    apiBase: row.apiBase,
    isDefault: row.isDefault,
    providerCredentialId: row.providerCredentialId,
    generatedOutputCapabilities: row.generatedOutputCapabilities as GeneratedOutputCapability[],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Map a contract scope string to the Prisma `ModelRoutingScope` enum value. */
function _toPrismaScope(scope: ModelRoutingScope): "Global" | "ClusterTenant"
{
  return scope === ModelRoutingScope.ClusterTenant ? "ClusterTenant" : "Global";
}

/**
 * Check an untrusted {@link ModelDefinitionWrite} body: `publicModelName` and `upstreamModel` are
 * both required, the scope must be `global` or `clusterTenant`, and a `clusterTenant`-scoped
 * model must name its owning ClusterTenant.
 *
 * @param body - The untrusted request body.
 * @returns `null` when the body is acceptable; otherwise `{ error, code }` with code
 *          `VALIDATION_ERROR`, which the route sends as the 400 body unchanged.
 */
function _validateWrite(body: Record<string, unknown>): { error: string; code: string } | null
{
  // 1. The routable slug and the upstream model are both required.
  const publicModelName = typeof body.publicModelName === "string" ? body.publicModelName.trim() : "";
  const upstreamModel = typeof body.upstreamModel === "string" ? body.upstreamModel.trim() : "";
  if (!publicModelName || !upstreamModel)
  {
    return { error: "publicModelName and upstreamModel are required.", code: "VALIDATION_ERROR" };
  }

  // 2. Scope must be one of the two known values when present.
  const scope = body.scope ?? ModelRoutingScope.Global;
  if (scope !== ModelRoutingScope.Global && scope !== ModelRoutingScope.ClusterTenant)
  {
    return { error: "scope must be 'global' or 'clusterTenant'.", code: "VALIDATION_ERROR" };
  }

  // 3. A ClusterTenant-scoped model must name its owning clusterTenant.
  if (scope === ModelRoutingScope.ClusterTenant && !(typeof body.clusterTenant === "string" && body.clusterTenant.trim()))
  {
    return { error: "clusterTenant is required when scope is 'clusterTenant'.", code: "VALIDATION_ERROR" };
  }

  const generatedOutputCapabilities = body.generatedOutputCapabilities ?? [];
  if (!Array.isArray(generatedOutputCapabilities) || generatedOutputCapabilities.some(function _UnsupportedCapability(capability) { return capability !== GeneratedOutputCapability.ImagePng && capability !== GeneratedOutputCapability.CodeExecutionFiles; }))
  {
    return { error: "generatedOutputCapabilities contains an unsupported capability.", code: "VALIDATION_ERROR" };
  }

  return null;
}

/**
 * Look up the credential a model write wants to use, and refuse it if it belongs to someone else.
 *
 * A model may bind a Global credential, or one owned by its OWN ClusterTenant — never another
 * customer's. That is what stops one tenant's model from spending another tenant's provider key.
 * Create and update both call this, so a PUT cannot slip past the rule that a POST enforces.
 *
 * @param prisma - Prisma client used to look up the credential.
 * @param providerCredentialId - The requested credential id, or undefined/null when none.
 * @param modelClusterTenant - The owning ClusterTenant of the model (null for Global scope).
 * @returns `{ secretRef, litellmCredentialName }` — both null when no credential was requested — or
 *          `{ error, code }` with `VALIDATION_ERROR` (no such credential) or
 *          `CREDENTIAL_SCOPE_MISMATCH` (owned by another ClusterTenant). A non-null
 *          `litellmCredentialName` means the key is in LiteLLM's credential store, so registration
 *          binds `litellm_credential_name` instead of the `os.environ` baseline.
 */
async function _resolveCredential(prisma: Prisma.TransactionClient, providerCredentialId: string | null | undefined, modelClusterTenant: string | null): Promise<{ secretRef: string | null; litellmCredentialName: string | null } | { error: string; code: string }>
{
  if (!providerCredentialId)
  {
    return { secretRef: null, litellmCredentialName: null };
  }
  const credential = await prisma.providerCredential.findUnique({ where: { id: providerCredentialId } });
  if (!credential)
  {
    return { error: "providerCredentialId does not reference an existing credential.", code: "VALIDATION_ERROR" };
  }
  const credentialClusterTenant = credential.scope === "ClusterTenant" ? credential.clusterTenant : null;
  if (credentialClusterTenant && credentialClusterTenant !== modelClusterTenant)
  {
    return { error: "providerCredentialId is owned by a different ClusterTenant.", code: "CREDENTIAL_SCOPE_MISMATCH" };
  }
  return { secretRef: credential.secretRef, litellmCredentialName: credential.litellmCredentialName };
}

/**
 * CRUD router for {@link ModelDefinition} — the routable models registered in LiteLLM (BYOM).
 *
 * On create the row is written and the model is registered GLOBALLY with LiteLLM via a best-effort
 * `POST /model/new` (guarded by `LITELLM_ENDPOINT` + `LITELLM_MASTER_KEY`). With LiteLLM
 * unconfigured a deterministic placeholder id is stored and the create still succeeds, so the row
 * exists but will not route until it is reconciled. Update does NOT re-register, so changing
 * `upstreamModel` here leaves the LiteLLM deployment pointing at the old model. Reads filter exact
 * `ModelDefinition` grants; mutations explicitly admit the silo's `Organization/Administer`
 * capability in the transaction that writes the definition.
 *
 * `GET /` considers Global and tenant rows but returns only the caller's entitled definitions.
 * An embedding deployment must still never be given a `ModelDefinition` row. See
 * `ByokProviderCatalog.embeddingModel` in
 * libs/backend/server/gateways/model-routing/main/src/core/byok-default-models.types.ts.
 *
 * Called by: apps/opencrane/src/app/routes.ts, mounted at `/api/v1/models`.
 *
 * @param prisma - Prisma client used for persistence.
 * @returns Configured Express router.
 */
export function modelRegistryRouter(prisma: PrismaClient, resolveCaller: ProviderGatewayCallerResolver = _ResolveProviderGatewayCaller, createAuthorization?: ProviderGatewayAuthorizationFactory<Prisma.TransactionClient>): Router
{
  const router = Router();
	const models = new PrismaProviderGatewayUnitOfWork(prisma, createAuthorization);

  /** List model definitions, optionally filtered to one ClusterTenant. */
  router.get("/", async function _listModels(req, res)
  {
	const caller = _RequireProviderGatewayCaller(req, res, resolveCaller);
	if (caller === null)
		return;
    const clusterTenant = typeof req.query.clusterTenant === "string" ? req.query.clusterTenant : undefined;
	const rows = await models.run(async function _List(transaction, authorization)
	{
		const candidates = await transaction.modelDefinition.findMany({ where: clusterTenant ? { clusterTenant } : undefined, orderBy: { createdAt: "asc" } });
		const entitled = await authorization.listPrincipalEntitled({ siloId: caller.siloId, principalId: caller.principalId, action: ProductAuthorizationActions.Read, resources: candidates.map(row => ({ kind: ProductAuthorizationResourceKinds.ModelDefinition, id: row.id })), nowEpochMs: Date.now() });
		const entitledIds = new Set(entitled.map(resource => resource.id));
		return candidates.filter(row => entitledIds.has(row.id));
	});
    res.json(rows.map(_toContract));
  });

  /** Get a single model definition by id. */
  router.get("/:id", async function _getModel(req, res)
  {
	const caller = _RequireProviderGatewayCaller(req, res, resolveCaller);
	if (caller === null)
		return;
	const row = await models.run(async function _Get(transaction, authorization)
	{
		const candidate = await transaction.modelDefinition.findUnique({ where: { id: req.params.id } });
		if (candidate === null)
			return null;
		const entitled = await authorization.listPrincipalEntitled({ siloId: caller.siloId, principalId: caller.principalId, action: ProductAuthorizationActions.Read, resources: [{ kind: ProductAuthorizationResourceKinds.ModelDefinition, id: candidate.id }], nowEpochMs: Date.now() });
		return entitled.length === 1 ? candidate : null;
	});
    if (!row)
    {
      res.status(404).json({ error: "Model definition not found", code: "MODEL_DEFINITION_NOT_FOUND" });
      return;
    }
    res.json(_toContract(row));
  });

  /** Create a model definition, registering it best-effort with LiteLLM. */
  router.post("/", async function _createModel(req, res)
  {
	const caller = _RequireProviderGatewayCaller(req, res, resolveCaller);
	if (caller === null)
		return;
    const body = (req.body ?? {}) as Record<string, unknown>;

    // 1. Validate the body before any persistence or upstream call.
    const error = _validateWrite(body);
    if (error)
    {
      res.status(400).json(error);
      return;
    }

    const write = body as unknown as ModelDefinitionWrite;
    const scope = write.scope ?? ModelRoutingScope.Global;

    // 2. Resolve + scope-check the backing credential (when set) — see _resolveCredential.
	try
	{
		const created = await models.run(async function _Create(transaction, authorization)
		{
			await _RequireProviderGatewayAdministration(authorization, caller, { operation: "create-model-definition", write });
			const credentialResult = await _resolveCredential(transaction, write.providerCredentialId, scope === ModelRoutingScope.ClusterTenant ? write.clusterTenant!.trim() : null);
			if ("error" in credentialResult)
				return credentialResult;
			const litellmModelId = await _RegisterLiteLlmModel({ publicModelName: write.publicModelName.trim(), upstreamModel: write.upstreamModel.trim(), scope, clusterTenant: scope === ModelRoutingScope.ClusterTenant ? write.clusterTenant!.trim() : null, apiBase: write.apiBase?.trim() || null, apiKeyEnvRef: credentialResult.secretRef, litellmCredentialName: credentialResult.litellmCredentialName });
			const model = await transaction.modelDefinition.create({ data: { scope: _toPrismaScope(scope), clusterTenant: scope === ModelRoutingScope.ClusterTenant ? write.clusterTenant!.trim() : null, publicModelName: write.publicModelName.trim(), litellmModelId, upstreamModel: write.upstreamModel.trim(), apiBase: write.apiBase?.trim() || null, isDefault: write.isDefault ?? false, providerCredentialId: write.providerCredentialId ?? null, generatedOutputCapabilities: write.generatedOutputCapabilities ?? [] } });
			await _GrantProviderResourceCreatorUse(authorization, caller, { kind: ProductAuthorizationResourceKinds.ModelDefinition, id: model.id }, new Date());
			return model;
		});
		if ("error" in created)
		{
			res.status(400).json(created);
			return;
		}
		res.status(201).json(_toContract(created));
	}
	catch (caught)
	{
		if (!_SendProviderGatewayAuthorizationError(caught, res))
			throw caught;
	}
  });

  /** Update a model definition (does not re-register with LiteLLM). */
  router.put("/:id", async function _updateModel(req, res)
  {
	const caller = _RequireProviderGatewayCaller(req, res, resolveCaller);
	if (caller === null)
		return;
    const body = (req.body ?? {}) as Record<string, unknown>;

    // 1. Validate the full replacement body.
    const error = _validateWrite(body);
    if (error)
    {
      res.status(400).json(error);
      return;
    }

    const write = body as unknown as ModelDefinitionWrite;
    const scope = write.scope ?? ModelRoutingScope.Global;
    const modelClusterTenant = scope === ModelRoutingScope.ClusterTenant ? write.clusterTenant!.trim() : null;

    // 2. Re-validate the backing credential with the SAME scope-isolation rule as create, so a PUT
    //    cannot bind (or smuggle in) another ClusterTenant's credential.
	try
	{
		const updated = await models.runDatabaseMutation(async function _Update(transaction, authorization)
		{
			const existing = await transaction.modelDefinition.findUnique({ where: { id: req.params.id } });
			if (existing === null)
				return null;
			await _RequireProviderGatewayAdministration(authorization, caller, { operation: "update-model-definition", id: existing.id, write });
			const credentialResult = await _resolveCredential(transaction, write.providerCredentialId, modelClusterTenant);
			if ("error" in credentialResult)
				return credentialResult;
			const data: Prisma.ModelDefinitionUncheckedUpdateInput = { scope: _toPrismaScope(scope), clusterTenant: modelClusterTenant, publicModelName: write.publicModelName.trim(), upstreamModel: write.upstreamModel.trim(), apiBase: write.apiBase?.trim() || null, isDefault: write.isDefault ?? false, providerCredentialId: write.providerCredentialId ?? null, generatedOutputCapabilities: write.generatedOutputCapabilities ?? [] };
			return transaction.modelDefinition.update({ where: { id: existing.id }, data });
		});
		if (updated === null)
		{
			res.status(404).json({ error: "Model definition not found", code: "MODEL_DEFINITION_NOT_FOUND" });
			return;
		}
		if ("error" in updated)
		{
			res.status(400).json(updated);
			return;
		}
		res.json(_toContract(updated));
	}
	catch (caught)
	{
		if (!_SendProviderGatewayAuthorizationError(caught, res))
			throw caught;
	}
  });

  /** Delete a model definition. */
  router.delete("/:id", async function _deleteModel(req, res)
  {
	const caller = _RequireProviderGatewayCaller(req, res, resolveCaller);
	if (caller === null)
		return;
	try
	{
		const deleted = await models.runDatabaseMutation(async function _Delete(transaction, authorization)
		{
			const existing = await transaction.modelDefinition.findUnique({ where: { id: req.params.id } });
			if (existing === null)
				return false;
			await _RequireProviderGatewayAdministration(authorization, caller, { operation: "delete-model-definition", id: existing.id });
			await transaction.modelDefinition.delete({ where: { id: existing.id } });
			return true;
		});
		if (!deleted)
		{
			res.status(404).json({ error: "Model definition not found", code: "MODEL_DEFINITION_NOT_FOUND" });
			return;
		}
		res.json({ id: req.params.id, status: "deleted" });
	}
	catch (caught)
	{
		if (!_SendProviderGatewayAuthorizationError(caught, res))
			throw caught;
	}
  });

  return router;
}
