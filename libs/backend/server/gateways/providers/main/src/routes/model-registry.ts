import { randomUUID } from "node:crypto";

import { Router } from "express";
import { GeneratedOutputCapability, ModelRoutingScope, type ModelDefinition, type ModelDefinitionWrite } from "@opencrane/contracts";
import type { Prisma, PrismaClient, ModelDefinition as PrismaModelDefinition } from "@prisma/client";

import { ProductAuthorizationActions, ProductAuthorizationResourceKinds } from "@opencrane/models/authorization";
import { _BYOK_PROVIDER_CATALOG } from "@opencrane/backend/server/gateways/model-routing";

import type { ProviderGatewayAuthorizationFactory, ProviderGatewayCaller, ProviderGatewayCallerResolver } from "../provider-gateway-authority.types";
import { _GrantProviderResourceCreatorUse, _RequireProviderGatewayAdministration, _RequireProviderGatewayCaller, _ResolveProviderGatewayCaller, _SendProviderGatewayAuthorizationError } from "../provider-gateway-authorization";
import { _PROVIDER_EFFECT_EXECUTOR_PROFILE } from "../provider-effect-command-composition";
import { _RequireProviderEffectAdmission, _SendProviderEffectBusy } from "../provider-effect-command-http";
import { ProviderEffectCommandKinds, ProviderEffectExecutionStatuses, ProviderEffectMaterialRequirements, type ProviderEffectCommandExecutor, type ProviderEffectExecutionContext } from "../provider-effect-command.types";
import { PrismaProviderGatewayUnitOfWork } from "../prisma-provider-gateway-unit-of-work";
import { _GLOBAL_AUTO_EMBEDDING_MODEL_NAME, _GLOBAL_AUTO_MODEL_NAME } from "../prisma-global-model-alias-repository";

/** Bind model delivery to the current caller, exact definition, and control-plane executor profile. */
function _effectContext(caller: ProviderGatewayCaller, modelDefinitionId: string): ProviderEffectExecutionContext
{
	return { siloId: caller.siloId, principalId: caller.principalId, actorKind: "user", actorId: caller.principalId, resourceKind: ProductAuthorizationResourceKinds.ModelDefinition, resourceId: modelDefinitionId, executorProfile: _PROVIDER_EFFECT_EXECUTOR_PROFILE };
}

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
	if (publicModelName === _GLOBAL_AUTO_MODEL_NAME || publicModelName === _GLOBAL_AUTO_EMBEDDING_MODEL_NAME)
		return { error: "publicModelName is reserved for centrally governed routing.", code: "MODEL_NAME_RESERVED" };

  // 2. Scope must be one of the two known values when present.
  const scope = body.scope ?? ModelRoutingScope.Global;
	if (scope !== ModelRoutingScope.Global && scope !== ModelRoutingScope.ClusterTenant)
  {
    return { error: "scope must be 'global' or 'clusterTenant'.", code: "VALIDATION_ERROR" };
  }
	if (scope === ModelRoutingScope.Global && body.isDefault === true)
		return { error: "Global defaults must be selected through model routing defaults.", code: "GLOBAL_MODEL_DEFAULT_GOVERNED" };
	if (scope === ModelRoutingScope.Global && Object.values(_BYOK_PROVIDER_CATALOG).some(function _Reserved(catalog)
	{
		return catalog.models.some(function _Model(model) { return model.slug === publicModelName; }) || catalog.embeddingModel?.slug === publicModelName;
	}))
		return { error: "publicModelName is reserved for provider catalogue reconciliation.", code: "MODEL_NAME_RESERVED" };

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
async function _resolveCredential(prisma: Prisma.TransactionClient, siloId: string, providerCredentialId: string | null | undefined, modelClusterTenant: string | null): Promise<{ secretRef: string | null; litellmCredentialName: string | null; provider: string | null } | { error: string; code: string }>
{
  if (!providerCredentialId)
  {
		return { secretRef: null, litellmCredentialName: null, provider: null };
  }
  const credential = await prisma.providerCredential.findUnique({ where: { id_siloId: { id: providerCredentialId, siloId } } });
  if (!credential)
  {
    return { error: "providerCredentialId does not reference an existing credential.", code: "VALIDATION_ERROR" };
  }
  const credentialClusterTenant = credential.scope === "ClusterTenant" ? credential.clusterTenant : null;
  if (credentialClusterTenant && credentialClusterTenant !== modelClusterTenant)
  {
    return { error: "providerCredentialId is owned by a different ClusterTenant.", code: "CREDENTIAL_SCOPE_MISMATCH" };
  }
  return { secretRef: credential.secretRef, litellmCredentialName: credential.litellmCredentialName ?? null, provider: credential.provider };
}

/** Returns why public CRUD cannot mutate one centrally governed model, or null for custom BYOM. */
async function _governedModelReason(transaction: Prisma.TransactionClient, model: PrismaModelDefinition): Promise<string | null>
{
	if (model.publicModelName === _GLOBAL_AUTO_MODEL_NAME || model.publicModelName === _GLOBAL_AUTO_EMBEDDING_MODEL_NAME)
		return "Reserved model aliases are managed by the global routing authority.";
	const routingDefault = await transaction.modelRoutingDefault.findFirst({ where: { siloId: model.siloId, scope: "Global", clusterTenant: null, defaultModel: model.publicModelName } });
	if (routingDefault !== null)
		return "The selected global model must be replaced through model routing defaults first.";
	if (model.providerCredentialId === null)
		return null;
	const credential = await transaction.providerCredential.findUnique({ where: { id_siloId: { id: model.providerCredentialId, siloId: model.siloId } } });
	const catalog = credential === null ? undefined : _BYOK_PROVIDER_CATALOG[credential.provider];
	if (catalog?.models.some(function _Owned(entry) { return entry.slug === model.publicModelName && entry.slug === model.upstreamModel; }))
		return "Provider catalogue models are managed by the provider key authority.";
	const alias = await transaction.modelDefinition.findFirst({ where: { siloId: model.siloId, scope: "Global", clusterTenant: null, publicModelName: _GLOBAL_AUTO_MODEL_NAME, providerCredentialId: model.providerCredentialId, upstreamModel: model.upstreamModel } });
	return alias === null ? null : "The current global alias still depends on this model's provider.";
}

/**
 * CRUD router for {@link ModelDefinition} — the routable models registered in LiteLLM (BYOM).
 *
 * On create the pending row and durable registration command commit together. The shared
 * application-root executor registers the model globally with LiteLLM after commit and replaces
 * the pending deployment id only in its final authorization transaction. A failed delivery returns
 * a resumable command id rather than treating a best-effort side effect as success. Update does NOT re-register, so changing
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
export function modelRegistryRouter(prisma: PrismaClient, effectExecutor: ProviderEffectCommandExecutor, resolveCaller: ProviderGatewayCallerResolver = _ResolveProviderGatewayCaller, createAuthorization?: ProviderGatewayAuthorizationFactory<Prisma.TransactionClient>): Router
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
		const candidates = await transaction.modelDefinition.findMany({ where: { siloId: caller.siloId, ...(clusterTenant ? { clusterTenant } : {}) }, orderBy: { createdAt: "asc" } });
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
		const candidate = await transaction.modelDefinition.findUnique({ where: { id_siloId: { id: req.params.id, siloId: caller.siloId } } });
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
		const commandId = randomUUID();
		const modelDefinitionId = randomUUID();
		const admitted = await models.runDatabaseMutation(async function _Create(transaction, authorization, effects)
		{
			const clusterTenant = scope === ModelRoutingScope.ClusterTenant ? write.clusterTenant!.trim() : null;
			const credentialResult = await _resolveCredential(transaction, caller.siloId, write.providerCredentialId, clusterTenant);
			if ("error" in credentialResult)
				return credentialResult;
			if (credentialResult.provider !== null)
			{
				const providerBlocker = await effects.findResourceBlocker(caller.siloId, ProductAuthorizationResourceKinds.ProviderConnection, `byok:${credentialResult.provider}`);
				if (providerBlocker !== null)
					return { providerEffectBlocker: providerBlocker } as const;
			}
			const publicModelName = write.publicModelName.trim();
			const upstreamModel = write.upstreamModel.trim();
			const apiBase = write.apiBase?.trim() || null;
			const admission = await _RequireProviderGatewayAdministration(authorization, caller, { operation: "create-model-definition", commandId, modelDefinitionId, scope, clusterTenant, publicModelName, upstreamModel, apiBase, providerCredentialId: write.providerCredentialId ?? null, generatedOutputCapabilities: write.generatedOutputCapabilities ?? [] });
			const model = await transaction.modelDefinition.create({ data: { id: modelDefinitionId, siloId: caller.siloId, scope: _toPrismaScope(scope), clusterTenant, publicModelName, litellmModelId: `pending:${commandId}`, upstreamModel, apiBase, isDefault: write.isDefault ?? false, providerCredentialId: write.providerCredentialId ?? null, generatedOutputCapabilities: write.generatedOutputCapabilities ?? [] } });
			await _GrantProviderResourceCreatorUse(authorization, caller, { kind: ProductAuthorizationResourceKinds.ModelDefinition, id: model.id }, new Date());
			const command = _RequireProviderEffectAdmission(await effects.admit({ id: commandId, siloId: caller.siloId, principalId: caller.principalId, payload: { kind: ProviderEffectCommandKinds.RegisterModel, value: { modelDefinitionId: model.id, publicModelName, upstreamModel, scope, clusterTenant, apiBase, apiKeyEnvRef: credentialResult.secretRef, litellmCredentialName: credentialResult.litellmCredentialName, routingDefaultId: null, selectedModelDefinitionId: null } }, resourceKind: ProductAuthorizationResourceKinds.ModelDefinition, resourceId: model.id, resourceRevision: commandId, argumentsDigest: admission.argumentsDigest, materialVerifier: null, authorization: admission.evidence, approvalId: null, executorProfile: _PROVIDER_EFFECT_EXECUTOR_PROFILE, materialRequirement: ProviderEffectMaterialRequirements.None }));
			return { command, model };
		});
		if ("providerEffectBlocker" in admitted && admitted.providerEffectBlocker !== undefined)
		{
			_SendProviderEffectBusy(res, admitted.providerEffectBlocker, "The selected provider is changing custody.");
			return;
		}
		if ("error" in admitted)
		{
			res.status(400).json(admitted);
			return;
		}
		const delivered = await effectExecutor.execute(admitted.command.id, undefined, _effectContext(caller, admitted.model.id));
		if (delivered.status !== ProviderEffectExecutionStatuses.Succeeded)
		{
			res.status(503).json({ error: "Model registration is admitted but has not completed.", code: "PROVIDER_EFFECT_PENDING", commandId: admitted.command.id, modelDefinitionId: admitted.model.id });
			return;
		}
		const created = await models.run(async function _ReadCreated(transaction) { return transaction.modelDefinition.findUnique({ where: { id_siloId: { id: admitted.model.id, siloId: caller.siloId } } }); });
		if (created === null)
			throw new Error("completed model registration command has no model definition");
		res.status(201).json(_toContract(created));
	}
	catch (caught)
	{
		if (!_SendProviderGatewayAuthorizationError(caught, res))
			throw caught;
	}
  });

  /** Resume one admitted model registration without creating another unique definition. */
  router.post("/:id/registration-commands/:commandId", async function _resumeModelRegistration(req, res)
  {
	const caller = _RequireProviderGatewayCaller(req, res, resolveCaller);
	if (caller === null)
		return;
	try
	{
		const delivered = await effectExecutor.execute(req.params.commandId, undefined, _effectContext(caller, req.params.id));
		if (delivered.status !== ProviderEffectExecutionStatuses.Succeeded && delivered.status !== ProviderEffectExecutionStatuses.AlreadySucceeded)
		{
			res.status(503).json({ error: "Model registration has not completed.", code: "PROVIDER_EFFECT_PENDING", commandId: req.params.commandId, modelDefinitionId: req.params.id });
			return;
		}
		const model = await models.run(async function _ReadResumed(transaction) { return transaction.modelDefinition.findUnique({ where: { id_siloId: { id: req.params.id, siloId: caller.siloId } } }); });
		if (model === null || model.litellmModelId.startsWith("pending:"))
		{
			res.status(503).json({ error: "Model registration has not completed.", code: "PROVIDER_EFFECT_PENDING", commandId: req.params.commandId, modelDefinitionId: req.params.id });
			return;
		}
		res.json(_toContract(model));
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
		const updated = await models.runDatabaseMutation(async function _Update(transaction, authorization, effects)
		{
			const existing = await transaction.modelDefinition.findUnique({ where: { id_siloId: { id: req.params.id, siloId: caller.siloId } } });
			if (existing === null)
				return null;
			await _RequireProviderGatewayAdministration(authorization, caller, { operation: "update-model-definition", id: existing.id, write });
			const governedReason = await _governedModelReason(transaction, existing);
			if (governedReason !== null)
				return { governedReason } as const;
			const blocker = await effects.findResourceBlocker(caller.siloId, ProductAuthorizationResourceKinds.ModelDefinition, existing.id);
			if (blocker !== null)
				return { providerEffectBlocker: blocker } as const;
			const credentialResult = await _resolveCredential(transaction, caller.siloId, write.providerCredentialId, modelClusterTenant);
			if ("error" in credentialResult)
				return credentialResult;
			if (credentialResult.provider !== null)
			{
				const providerBlocker = await effects.findResourceBlocker(caller.siloId, ProductAuthorizationResourceKinds.ProviderConnection, `byok:${credentialResult.provider}`);
				if (providerBlocker !== null)
					return { providerEffectBlocker: providerBlocker } as const;
			}
			const data: Prisma.ModelDefinitionUncheckedUpdateInput = { scope: _toPrismaScope(scope), clusterTenant: modelClusterTenant, publicModelName: write.publicModelName.trim(), upstreamModel: write.upstreamModel.trim(), apiBase: write.apiBase?.trim() || null, isDefault: write.isDefault ?? false, providerCredentialId: write.providerCredentialId ?? null, generatedOutputCapabilities: write.generatedOutputCapabilities ?? [] };
			return transaction.modelDefinition.update({ where: { id_siloId: { id: existing.id, siloId: caller.siloId } }, data });
		});
		if (updated === null)
		{
			res.status(404).json({ error: "Model definition not found", code: "MODEL_DEFINITION_NOT_FOUND" });
			return;
		}
		if ("providerEffectBlocker" in updated && updated.providerEffectBlocker !== undefined)
		{
			_SendProviderEffectBusy(res, updated.providerEffectBlocker, "Model registration is still active.");
			return;
		}
		if ("governedReason" in updated)
		{
			res.status(409).json({ error: updated.governedReason, code: "MODEL_DEFINITION_GOVERNED" });
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
		const deleted = await models.runDatabaseMutation(async function _Delete(transaction, authorization, effects)
		{
			const existing = await transaction.modelDefinition.findUnique({ where: { id_siloId: { id: req.params.id, siloId: caller.siloId } } });
			if (existing === null)
				return { deleted: false, blocker: null, governedReason: null } as const;
			await _RequireProviderGatewayAdministration(authorization, caller, { operation: "delete-model-definition", id: existing.id });
			const governedReason = await _governedModelReason(transaction, existing);
			if (governedReason !== null)
				return { deleted: false, blocker: null, governedReason } as const;
			const blocker = await effects.findResourceBlocker(caller.siloId, ProductAuthorizationResourceKinds.ModelDefinition, existing.id);
			if (blocker !== null)
				return { deleted: false, blocker, governedReason: null } as const;
			await transaction.modelDefinition.delete({ where: { id_siloId: { id: existing.id, siloId: caller.siloId } } });
			return { deleted: true, blocker: null, governedReason: null } as const;
		});
		if (deleted.governedReason !== null)
		{
			res.status(409).json({ error: deleted.governedReason, code: "MODEL_DEFINITION_GOVERNED" });
			return;
		}
		if (deleted.blocker !== null)
		{
			_SendProviderEffectBusy(res, deleted.blocker, "Model registration is still active.");
			return;
		}
		if (!deleted.deleted)
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
