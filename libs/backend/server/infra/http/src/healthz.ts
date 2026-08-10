import type { RequestHandler } from "express";

import type { DbHealthProbeUnitOfWork } from "./healthz.types.js";

export type { DbHealthProbeRepository, DbHealthProbeUnitOfWork } from "./healthz.types.js";

/**
 * Build a `/healthz` handler that performs request-bearing database I/O.
 * Returns 200 `{ status: "ok", db: true }` on success, 503 `{ status: "degraded", db: false }`
 * when the database check rejects. Shared by the fleet registry DB and each silo's per-CT DB.
 *
 * @param db - Narrow database health probe supplied by the composing process.
 * @returns Express handler for the `/healthz` endpoint.
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
