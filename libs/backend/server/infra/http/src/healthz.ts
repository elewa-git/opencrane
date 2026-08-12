import type { RequestHandler } from "express";

import type { DbHealthProbeUnitOfWork } from "./healthz.types.js";

export type { DbHealthProbeRepository, DbHealthProbeUnitOfWork } from "./healthz.types.js";

/**
 * Build the `/healthz` handler, which answers by actually querying the database.
 *
 * A cheap 200 would let a pod look healthy while its database was gone, so the handler awaits a real
 * query: 200 `{ status: "ok", db: true }` when it succeeds, 503 `{ status: "degraded", db: false }`
 * when it rejects. The error itself is swallowed on purpose — `/healthz` is unauthenticated, so it
 * must not describe the failure; look in the logs instead. The same handler serves the fleet
 * registry database and each silo's per-ClusterTenant database. Note that rate-limit.ts exempts
 * `/healthz`, so probes are never throttled.
 *
 * Called by: apps/opencrane/src/app/routes.ts, mounted as `GET /healthz`.
 *
 * @param db - Database check supplied by the composing process, which owns the Prisma client.
 * @returns Express handler for `/healthz`. It never throws and never calls `next` with an error.
 */
export function _CheckDbHealth(db: DbHealthProbeUnitOfWork): RequestHandler
{
  return async function _checkDbHealth(_req, res)
  {
    try
    {
      await db.check();
      res.status(200).json({ status: "ok", db: true });
    }
    catch
    {
      res.status(503).json({ status: "degraded", db: false });
    }
  };
}
