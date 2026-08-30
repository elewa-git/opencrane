import { Router } from "express";
import type { Prisma, PrismaClient } from "@prisma/client";

import type { ProviderGatewayAuthorizationFactory, ProviderGatewayCallerResolver } from "../provider-gateway-authority.types";
import { _RequireProviderGatewayCaller, _ResolveProviderGatewayCaller, _SendProviderGatewayAuthorizationError } from "../provider-gateway-authorization";
import { MODEL_DEFINITION_MUTATION_GOVERNED } from "../model-definition-service.types";
import type { ProviderEffectCommandExecutor } from "../provider-effect-command.types";
import { PrismaModelDefinitionUnitOfWork } from "../prisma-model-definition-service";

/**
 * Mount the model registry's HTTP transport over the durable model-definition service.
 *
 * On create the pending row and durable registration command commit together. The shared
 * application-root executor registers the model globally with LiteLLM after commit and replaces
 * the pending deployment id only in its final authorization transaction. A failed delivery returns
 * a resumable command id rather than treating incomplete durable registration as success. Reads filter
 * exact `ModelDefinition` grants. PUT and DELETE fail closed until they have durable commands that
 * converge Postgres and LiteLLM together.
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
	const models = new PrismaModelDefinitionUnitOfWork(prisma, effectExecutor, createAuthorization);

  /** List model definitions, optionally filtered to one ClusterTenant. */
  router.get("/", async function _listModels(req, res)
  {
	const caller = _RequireProviderGatewayCaller(req, res, resolveCaller);
	if (caller === null)
		return;
	const clusterTenant = typeof req.query.clusterTenant === "string" ? req.query.clusterTenant : undefined;
	res.json(await models.list(caller, clusterTenant));
  });

  /** Get a single model definition by id. */
  router.get("/:id", async function _getModel(req, res)
  {
	const caller = _RequireProviderGatewayCaller(req, res, resolveCaller);
	if (caller === null)
		return;
	const model = await models.get(caller, req.params.id);
    if (model === null)
    {
      res.status(404).json({ error: "Model definition not found", code: "MODEL_DEFINITION_NOT_FOUND" });
      return;
    }
    res.json(model);
  });

  /** Create a model definition through required durable LiteLLM registration. */
  router.post("/", async function _createModel(req, res)
  {
	const caller = _RequireProviderGatewayCaller(req, res, resolveCaller);
	if (caller === null)
		return;
	try
	{
		const result = await models.create(caller, req.body);
		if (result.status === "invalid")
		{
			res.status(400).json(result.failure);
			return;
		}
		if (result.status === "busy")
		{
			res.status(409).json({ error: "The selected provider is changing custody.", code: "PROVIDER_EFFECT_BUSY", commandId: result.blocker.commandId });
			return;
		}
		if (result.status === "pending")
		{
			res.status(503).json({ error: "Model registration is admitted but has not completed.", code: "PROVIDER_EFFECT_PENDING", commandId: result.commandId, modelDefinitionId: result.modelDefinitionId });
			return;
		}
		res.status(201).json(result.model);
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
		const result = await models.resume(caller, req.params.id, req.params.commandId);
		if (result.status === "pending")
		{
			res.status(503).json({ error: "Model registration has not completed.", code: "PROVIDER_EFFECT_PENDING", commandId: result.commandId, modelDefinitionId: result.modelDefinitionId });
			return;
		}
		res.json(result.model);
	}
	catch (caught)
	{
		if (!_SendProviderGatewayAuthorizationError(caught, res))
			throw caught;
	}
  });

	/** Refuse DB-only updates until a durable update command converges the external deployment. */
	router.put("/:id", function _RefuseModelUpdate(req, res)
	{
		if (_RequireProviderGatewayCaller(req, res, resolveCaller) === null)
			return;
		res.status(409).json(MODEL_DEFINITION_MUTATION_GOVERNED);
	});

	/** Refuse DB-only deletion until a durable unregister command converges the external deployment. */
	router.delete("/:id", function _RefuseModelDeletion(req, res)
	{
		if (_RequireProviderGatewayCaller(req, res, resolveCaller) === null)
			return;
		res.status(409).json(MODEL_DEFINITION_MUTATION_GOVERNED);
	});

  return router;
}
