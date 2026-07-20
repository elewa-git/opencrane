import { Router } from "express";
import { AutoRoutingObjective, ModelRoutingScope, type AutoRoutingConfig, type ModelRoutingDefault, type ModelRoutingDefaultWrite } from "@opencrane/contracts";
import { Prisma, type PrismaClient, type ModelRoutingDefault as PrismaModelRoutingDefault } from "@prisma/client";

import { _ClusterTenantScopeGuard, type ClusterTenantScopedResource } from "@opencrane/backend/server/cluster-tenants";
import type { ValidationFailure } from "./model-routing-defaults.types.js";

/** The valid {@link AutoRoutingObjective} string values, used to validate an incoming config. */
const _VALID_OBJECTIVES: readonly string[] = Object.values(AutoRoutingObjective);

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
 * Validate the shape of an inbound {@link AutoRoutingConfig}. Only checks the fields that carry a
 * closed contract (objective enum, required booleans, numeric ranges) — the surface is a config
 * blob, so unknown extra keys are tolerated. Returns a failure envelope or null when acceptable.
 *
 * @param raw - The untrusted `autoConfig` value from the request body.
 * @returns A `{ error, code }` payload when invalid; null when valid.
 */
function _validateAutoConfig(raw: unknown): ValidationFailure | null
{
  // 1. Must be a plain object — anything else cannot carry the required config knobs.
  if (typeof raw !== "object" || raw === null || Array.isArray(raw))
  {
    return { error: "autoConfig must be an object.", code: "VALIDATION_ERROR" };
  }

  const config = raw as Record<string, unknown>;

  // 2. The optimization objective is the one required closed enum on the config.
  if (typeof config.objective !== "string" || !_VALID_OBJECTIVES.includes(config.objective))
  {
    return { error: `autoConfig.objective must be one of: ${_VALID_OBJECTIVES.join(", ")}.`, code: "VALIDATION_ERROR" };
  }

  // 3. sessionPin and explorationRate are required by the contract; enforce their types/range so a
  //    malformed config cannot reach the runtime optimizer (AIR.7) as silently-wrong knobs.
  if (typeof config.sessionPin !== "boolean")
  {
    return { error: "autoConfig.sessionPin must be a boolean.", code: "VALIDATION_ERROR" };
  }
  if (typeof config.explorationRate !== "number" || config.explorationRate < 0 || config.explorationRate > 1)
  {
    return { error: "autoConfig.explorationRate must be a number between 0 and 1.", code: "VALIDATION_ERROR" };
  }

  return null;
}

/**
 * Validate a {@link ModelRoutingDefaultWrite} body. Enforces a valid scope, a `clusterTenant`
 * when the scope is `clusterTenant`, at least one of `defaultModel`/`autoConfig` (an empty
 * default is meaningless), and a well-formed `autoConfig` when present.
 *
 * @param body - The untrusted request body.
 * @returns A `{ error, code }` payload when invalid; null when valid.
 */
function _validateWrite(body: Record<string, unknown>): ValidationFailure | null
{
  // 1. Scope must be one of the two known values when present.
  const scope = body.scope ?? ModelRoutingScope.Global;
  if (scope !== ModelRoutingScope.Global && scope !== ModelRoutingScope.ClusterTenant)
  {
    return { error: "scope must be 'global' or 'clusterTenant'.", code: "VALIDATION_ERROR" };
  }

  // 2. A ClusterTenant-scoped default must name its owning clusterTenant.
  if (scope === ModelRoutingScope.ClusterTenant && !(typeof body.clusterTenant === "string" && body.clusterTenant.trim()))
  {
    return { error: "clusterTenant is required when scope is 'clusterTenant'.", code: "VALIDATION_ERROR" };
  }

  // 3. A default that names neither a model nor an auto config carries no decision — reject it.
  const hasModel = typeof body.defaultModel === "string" && body.defaultModel.trim().length > 0;
  const hasAuto = body.autoConfig !== undefined && body.autoConfig !== null;
  if (!hasModel && !hasAuto)
  {
    return { error: "at least one of defaultModel or autoConfig is required.", code: "VALIDATION_ERROR" };
  }

  // 4. When an auto config is supplied it must be well-formed.
  if (hasAuto)
  {
    const autoError = _validateAutoConfig(body.autoConfig);
    if (autoError)
    {
      return autoError;
    }
  }

  return null;
}

/**
 * CRUD router for {@link ModelRoutingDefault} — the scope-level model + auto-config default
 * consulted when a skill declares no posture of its own (Track AIR.4). A default is uniquely keyed
 * by `(scope, clusterTenant)`, so the write path upserts on that key rather than allocating a new
 * row each time. Mutations are gated by the ClusterTenant scope guard (AIR.0b): a Global-scoped
 * default is operator-only; a ClusterTenant-scoped default may be written by that ClusterTenant.
 *
 * @param prisma - Prisma client used for persistence.
 * @returns Configured Express router.
 */
export function modelRoutingDefaultsRouter(prisma: PrismaClient): Router
{
  const router = Router();

  // Mutation guard: resolve the targeted default's scope so the guard can decide. For PUT (upsert)
  // the scope comes from the body; for DELETE from the persisted row.
  const guard = _ClusterTenantScopeGuard(prisma, async function _resolveResource(req): Promise<ClusterTenantScopedResource | null>
  {
    if (req.method === "PUT")
    {
      const body = (req.body ?? {}) as ModelRoutingDefaultWrite;
      return { scope: body.scope ?? ModelRoutingScope.Global, clusterTenant: body.clusterTenant ?? null };
    }

    const row = await prisma.modelRoutingDefault.findUnique({ where: { id: String(req.params.id) } });
    if (!row)
    {
      return null;
    }
    return { scope: row.scope === "ClusterTenant" ? ModelRoutingScope.ClusterTenant : ModelRoutingScope.Global, clusterTenant: row.clusterTenant };
  });

  router.put("/", guard);
  router.delete("/:id", guard);

  /** List model-routing defaults, optionally filtered to one ClusterTenant. */
  router.get("/", async function _listDefaults(req, res)
  {
    const clusterTenant = typeof req.query.clusterTenant === "string" ? req.query.clusterTenant : undefined;
    const rows = await prisma.modelRoutingDefault.findMany({
      where: clusterTenant ? { clusterTenant } : undefined,
      orderBy: { createdAt: "asc" },
    });
    res.json(rows.map(_toContract));
  });

  /** Get a single model-routing default by id. */
  router.get("/:id", async function _getDefault(req, res)
  {
    const row = await prisma.modelRoutingDefault.findUnique({ where: { id: req.params.id } });
    if (!row)
    {
      res.status(404).json({ error: "Model routing default not found", code: "MODEL_ROUTING_DEFAULT_NOT_FOUND" });
      return;
    }
    res.json(_toContract(row));
  });

  /** Upsert the model-routing default for a (scope, clusterTenant) pair. */
  router.put("/", async function _upsertDefault(req, res)
  {
    const body = (req.body ?? {}) as Record<string, unknown>;

    // 1. Validate the body before any persistence.
    const error = _validateWrite(body);
    if (error)
    {
      res.status(400).json(error);
      return;
    }

    const write = body as unknown as ModelRoutingDefaultWrite;
    const scope = write.scope ?? ModelRoutingScope.Global;
    const clusterTenant = scope === ModelRoutingScope.ClusterTenant ? write.clusterTenant!.trim() : null;
    const defaultModel = typeof write.defaultModel === "string" && write.defaultModel.trim() ? write.defaultModel.trim() : null;

    // 2. Normalise the optional JSON column: a supplied config is stored verbatim, an explicit
    //    null clears it (Prisma.JsonNull writes a SQL JSON null, not column NULL — matches the
    //    nullable Json column and round-trips back to null on read).
    const autoConfigValue: Prisma.InputJsonValue | typeof Prisma.JsonNull = write.autoConfig
      ? (write.autoConfig as unknown as Prisma.InputJsonValue)
      : Prisma.JsonNull;

    // 3. Upsert on the (scope, clusterTenant) pair so repeated writes update in place. Prisma's
    //    compound-unique selector cannot express a null clusterTenant (Global scope), so resolve the
    //    existing row with findFirst then branch. Uniqueness is DB-enforced (compound index for
    //    ClusterTenant rows; a partial unique index for the Global row — migration 0018); if a
    //    concurrent create loses that race it surfaces as P2002, so fall back to updating the
    //    now-existing row, keeping the upsert idempotent under concurrency.
    const prismaScope = _toPrismaScope(scope);
    const data = { defaultModel, autoConfig: autoConfigValue };
    const existing = await prisma.modelRoutingDefault.findFirst({ where: { scope: prismaScope, clusterTenant } });
    let row: PrismaModelRoutingDefault;
    if (existing)
    {
      row = await prisma.modelRoutingDefault.update({ where: { id: existing.id }, data });
    }
    else
    {
      try
      {
        row = await prisma.modelRoutingDefault.create({ data: { scope: prismaScope, clusterTenant, ...data } });
      }
      catch (err)
      {
        // Lost the create race against a concurrent writer — the unique index rejected us; update theirs.
        const raced = err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002"
          ? await prisma.modelRoutingDefault.findFirst({ where: { scope: prismaScope, clusterTenant } })
          : null;
        if (!raced)
        {
          throw err;
        }
        row = await prisma.modelRoutingDefault.update({ where: { id: raced.id }, data });
      }
    }
    res.json(_toContract(row));
  });

  /** Delete a model-routing default by id. */
  router.delete("/:id", async function _deleteDefault(req, res)
  {
    const existing = await prisma.modelRoutingDefault.findUnique({ where: { id: req.params.id } });
    if (!existing)
    {
      res.status(404).json({ error: "Model routing default not found", code: "MODEL_ROUTING_DEFAULT_NOT_FOUND" });
      return;
    }
    await prisma.modelRoutingDefault.delete({ where: { id: req.params.id } });
    res.json({ id: req.params.id, status: "deleted" });
  });

  return router;
}
