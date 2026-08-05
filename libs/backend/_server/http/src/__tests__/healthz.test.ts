import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { _CheckDbHealth, type DbHealthProbe } from "../healthz.js";

/**
 * Build a minimal Express app mounting the healthz handler over a mocked DB probe.
 * @param dbHealthy - Whether the mocked `$queryRaw` should resolve or reject.
 * @returns An Express app wired for health-check testing.
 */
function _buildHealthApp(dbHealthy: boolean): express.Express
{
  const db = {
    $queryRaw: dbHealthy ? vi.fn().mockResolvedValue([{ 1: 1 }]) : vi.fn().mockRejectedValue(new Error("db down")),
  } as unknown as DbHealthProbe;
  const app = express();
  app.get("/healthz", _CheckDbHealth(db));
  return app;
}

describe("_CheckDbHealth — DB liveness probe", function _suite()
{
  it("returns ok when the DB is reachable", async function _ok()
  {
    const res = await request(_buildHealthApp(true)).get("/healthz");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok", db: true });
  });

  it("returns degraded when the DB is unreachable", async function _degraded()
  {
    const res = await request(_buildHealthApp(false)).get("/healthz");
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: "degraded", db: false });
  });
});
