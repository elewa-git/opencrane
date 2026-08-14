import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { _CheckDbHealth, type DbHealthProbeUnitOfWork } from "../healthz";

/**
 * Build a minimal Express app mounting the healthz handler over a mocked DB probe.
 * @param db - Database health probe to mount.
 * @returns An Express app wired for health-check testing.
 */
function _buildHealthApp(db: DbHealthProbeUnitOfWork): express.Express
{
  const app = express();
  app.get("/healthz", _CheckDbHealth(db));
  return app;
}

describe("_CheckDbHealth — DB liveness probe", function _suite()
{
  it("returns ok when the DB is reachable", async function _ok()
  {
    const check = vi.fn().mockResolvedValue(undefined);
    const res = await request(_buildHealthApp({ check })).get("/healthz");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok", db: true });
    expect(check).toHaveBeenCalledOnce();
  });

  it("performs fresh I/O and degrades after an earlier successful check", async function _degraded()
  {
    const check = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("db down"));
    const app = _buildHealthApp({ check });
    const healthy = await request(app).get("/healthz");
    const degraded = await request(app).get("/healthz");
    expect(healthy.status).toBe(200);
    expect(degraded.status).toBe(503);
    expect(degraded.body).toEqual({ status: "degraded", db: false });
    expect(check).toHaveBeenCalledTimes(2);
  });
});
