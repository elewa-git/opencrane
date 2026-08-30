import { Router } from "express";
import { Prisma, type PrismaClient, type ModelRoutingDefault as PrismaModelRoutingDefault } from "@prisma/client";

import { ___WithValidatedPublicBody } from "@opencrane/backend/server/infra/http";
import { ___ModelRoutingDefaultWriteSchema, ModelRoutingScope, type AutoRoutingConfig, type ModelRoutingDefault } from "@opencrane/contracts";
import type { GlobalModelRoutingDefaultCommandPort, ModelRoutingAuthorizationFactory, ModelRoutingCallerResolver } from "./model-routing-authorization.types";
import { _CanAdministerModelRouting, _RequireModelRoutingAdministration, _RequireModelRoutingCaller, _ResolveModelRoutingCaller, _SendModelRoutingAuthorizationError } from "./model-routing-authorization";
import { PrismaModelRoutingUnitOfWork } from "./prisma-model-routing-unit-of-work";

/**
 * Project a persisted `ModelRoutingDefault` row into its contract DTO. The Prisma enum maps 1:1
 * to the lowercase {@link ModelRoutingScope} union, and the `autoConfig` JSON column is returned
 * verbatim (validated on write, so trusted on read).
 *
 * @param row - The persisted row.
 * @returns The contract-shaped default (timestamps as ISO-8601 strings).
 */
function _toContract(row: PrismaModelRoutingDefault): ModelRoutingDefault
{
  return {
    id: row.id,
    scope: row.scope === "ClusterTenant" ? ModelRoutingScope.ClusterTenant : ModelRoutingScope.Global,
    clusterTenant: row.clusterTenant,
    defaultModel: row.defaultModel,
    autoConfig: (row.autoConfig as AutoRoutingConfig | null) ?? null,
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
 * CRUD router for {@link ModelRoutingDefault} — the scope-level model + auto-config default
 * consulted when a skill declares no posture of its own (Track AIR.4). A default is uniquely keyed
 * by `(scope, clusterTenant)`, so the write path upserts on that key rather than allocating a new
 * row each time. Reads and writes explicitly require the silo's `Organization/Administer`
 * capability because routing defaults are organisation policy, not model-definition instances.
 *
 * @param prisma - Prisma client used for persistence.
 * @returns Configured Express router.
 */
export function modelRoutingDefaultsRouter(prisma: PrismaClient, resolveCaller: ModelRoutingCallerResolver = _ResolveModelRoutingCaller, createAuthorization?: ModelRoutingAuthorizationFactory<Prisma.TransactionClient>, globalCommands: GlobalModelRoutingDefaultCommandPort | null = null): Router
{
  const router = Router();
	const routing = new PrismaModelRoutingUnitOfWork(prisma, createAuthorization);
  /** List model-routing defaults, optionally filtered to one ClusterTenant. */
  router.get("/", async function _listDefaults(req, res)
  {
	const caller = _RequireModelRoutingCaller(req, res, resolveCaller);
	if (caller === null)
		return;
    const clusterTenant = typeof req.query.clusterTenant === "string" ? req.query.clusterTenant : undefined;
	const rows = await routing.run(async function _List(transaction, authorization)
	{
		if (!(await _CanAdministerModelRouting(authorization, caller)))
			return [];
		return transaction.modelRoutingDefault.findMany({ where: { siloId: caller.siloId, ...(clusterTenant ? { clusterTenant } : {}) }, orderBy: { createdAt: "asc" } });
	});
    res.json(rows.map(_toContract));
  });

  /** Get a single model-routing default by id. */
  router.get("/:id", async function _getDefault(req, res)
  {
	const caller = _RequireModelRoutingCaller(req, res, resolveCaller);
	if (caller === null)
		return;
	const row = await routing.run(async function _Get(transaction, authorization)
	{
		if (!(await _CanAdministerModelRouting(authorization, caller)))
			return null;
		return transaction.modelRoutingDefault.findUnique({ where: { id_siloId: { id: req.params.id, siloId: caller.siloId } } });
	});
    if (!row)
    {
      res.status(404).json({ error: "Model routing default not found", code: "MODEL_ROUTING_DEFAULT_NOT_FOUND" });
      return;
    }
    res.json(_toContract(row));
  });

  /** Upsert the model-routing default for a (scope, clusterTenant) pair. */
  router.put("/", ___WithValidatedPublicBody(___ModelRoutingDefaultWriteSchema, async function _upsertDefault(req, res, _next, write)
  {
	const caller = _RequireModelRoutingCaller(req, res, resolveCaller);
	if (caller === null)
		return;
    // 1. Normalise the validated command before persistence.
    const scope = write.scope ?? ModelRoutingScope.Global;
    const clusterTenant = scope === ModelRoutingScope.ClusterTenant ? write.clusterTenant!.trim() : null;
    const defaultModel = typeof write.defaultModel === "string" && write.defaultModel.trim() ? write.defaultModel.trim() : null;
	if (scope === ModelRoutingScope.Global)
	{
		if (defaultModel === null)
		{
			res.status(400).json({ error: "A Global routing default must select one model.", code: "VALIDATION_ERROR" });
			return;
		}
		if (globalCommands === null)
		{
			res.status(503).json({ error: "Global routing reconciliation is unavailable.", code: "GLOBAL_MODEL_ROUTING_UNAVAILABLE" });
			return;
		}
		let result;
		try
		{
			result = await globalCommands.upsert(caller, { defaultModel, autoConfig: write.autoConfig ?? null });
		}
		catch (caught)
		{
			if (!_SendModelRoutingAuthorizationError(caught, res))
				throw caught;
			return;
		}
		if (result.status === "succeeded")
		{
			res.json(result.value);
			return;
		}
		if (result.status === "busy")
		{
			res.status(409).json({ error: "Global model alias reconciliation is already active.", code: "PROVIDER_EFFECT_BUSY", commandId: result.commandId });
			return;
		}
		res.status(503).json({ error: "Global model alias reconciliation has not completed.", code: "PROVIDER_EFFECT_PENDING", commandId: result.commandId });
		return;
	}

    // 2. Normalise the optional JSON column: a supplied config is stored verbatim, an explicit
    //    null clears it (Prisma.JsonNull writes a SQL JSON null, not column NULL — matches the
    //    nullable Json column and round-trips back to null on read).
    const autoConfigValue: Prisma.InputJsonValue | typeof Prisma.JsonNull = write.autoConfig
      ? (write.autoConfig as unknown as Prisma.InputJsonValue)
      : Prisma.JsonNull;

    // 3. Upsert on the (scope, clusterTenant) pair so repeated writes update in place. Prisma's
    //    compound-unique selector cannot express a null clusterTenant (Global scope), so resolve the
    //    existing row with findFirst then branch. Uniqueness is DB-enforced (compound index for
    //    ClusterTenant rows; a partial unique index for the Global row in the target baseline); if a
    //    concurrent create loses that race it surfaces as P2002, so fall back to updating the
    //    now-existing row, keeping the upsert idempotent under concurrency.
    const prismaScope = _toPrismaScope(scope);
    const data = { defaultModel, autoConfig: autoConfigValue };
	try
	{
		const row = await routing.run(async function _Upsert(transaction, authorization): Promise<PrismaModelRoutingDefault>
		{
			await _RequireModelRoutingAdministration(authorization, caller, { operation: "upsert-model-routing-default", scope, clusterTenant, defaultModel, autoConfig: write.autoConfig ?? null });
			const existing = await transaction.modelRoutingDefault.findFirst({ where: { siloId: caller.siloId, scope: prismaScope, clusterTenant } });
			if (existing)
				return transaction.modelRoutingDefault.update({ where: { id_siloId: { id: existing.id, siloId: caller.siloId } }, data });
			try
			{
				return await transaction.modelRoutingDefault.create({ data: { siloId: caller.siloId, scope: prismaScope, clusterTenant, ...data } });
			}
			catch (error)
			{
				const raced = error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002" ? await transaction.modelRoutingDefault.findFirst({ where: { siloId: caller.siloId, scope: prismaScope, clusterTenant } }) : null;
				if (raced === null)
					throw error;
				return transaction.modelRoutingDefault.update({ where: { id_siloId: { id: raced.id, siloId: caller.siloId } }, data });
			}
		});
		res.json(_toContract(row));
	}
	catch (caught)
	{
		if (!_SendModelRoutingAuthorizationError(caught, res))
			throw caught;
	}
  }));

  /** Delete a model-routing default by id. */
  router.delete("/:id", async function _deleteDefault(req, res)
  {
	const caller = _RequireModelRoutingCaller(req, res, resolveCaller);
	if (caller === null)
		return;
	try
	{
		const deleted = await routing.run(async function _Delete(transaction, authorization)
		{
			const existing = await transaction.modelRoutingDefault.findUnique({ where: { id_siloId: { id: req.params.id, siloId: caller.siloId } } });
			if (existing === null)
				return false;
			await _RequireModelRoutingAdministration(authorization, caller, { operation: "delete-model-routing-default", id: existing.id });
			if (existing.scope === "Global")
				return "governed" as const;
			await transaction.modelRoutingDefault.delete({ where: { id_siloId: { id: existing.id, siloId: caller.siloId } } });
			return true;
		});
		if (deleted === "governed")
		{
			res.status(409).json({ error: "Global routing defaults must be replaced, not deleted.", code: "GLOBAL_MODEL_DEFAULT_GOVERNED" });
			return;
		}
		if (!deleted)
		{
			res.status(404).json({ error: "Model routing default not found", code: "MODEL_ROUTING_DEFAULT_NOT_FOUND" });
			return;
		}
		res.json({ id: req.params.id, status: "deleted" });
	}
	catch (caught)
	{
		if (!_SendModelRoutingAuthorizationError(caught, res))
			throw caught;
	}
  });

  return router;
}
