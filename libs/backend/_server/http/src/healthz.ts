import type { RequestHandler } from "express";

import type { DbHealthProbe } from "./healthz.types.js";

export type { DbHealthProbe } from "./healthz.types.js";

/**
 * Build a `/healthz` handler that verifies database connectivity with a `SELECT 1`.
 * Returns 200 `{ status: "ok", db: true }` on success, 503 `{ status: "degraded", db: false }`
 * when the query throws. Shared by the fleet registry DB and each silo's per-CT DB.
 *
 * @param db - Any Prisma client (structurally; only `$queryRaw` is used).
 * @returns Express handler for the `/healthz` endpoint.
 */
export function _CheckDbHealth(db: DbHealthProbe): RequestHandler
{
  return async function _checkDbHealth(_req, res)
  {
    try
    {
      await db.$queryRaw`SELECT 1`;
      res.status(200).json({ status: "ok", db: true });
    }
    catch
    {
      res.status(503).json({ status: "degraded", db: false });
    }
  };
}
