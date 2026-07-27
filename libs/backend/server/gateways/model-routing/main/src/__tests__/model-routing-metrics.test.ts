import express from "express";
import type { Express } from "express";
import type { PrismaClient } from "@prisma/client";
import session from "express-session";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Side-effect import: loads the express-session SessionData.authUser augmentation.
import "@opencrane/server/_infra/auth";
import type { AuthUser } from "@opencrane/server/_infra/auth";
import { modelRoutingMetricsRouter } from "../routes/model-routing-metrics.js";

/** Build a complete OIDC session identity accepted by the metrics scope resolver. */
function _authUser(overrides: Partial<AuthUser> = {}): AuthUser
{
  return {
    sub: "user-1",
    issuer: "https://idp.example.test",
    groups: [],
    isPlatformOperator: false,
    isOrgAdmin: false,
    email: "user@example.test",
    authenticatedAt: "2026-06-18T00:00:00.000Z",
    ...overrides,
  };
}

/** Build a Prisma stub whose membership lookup resolves to a fixed ClusterTenant. */
function _mockPrisma(tenantClusterTenant: string | null = null): PrismaClient
{
  return {
    orgMembership: { findMany: async function _fm() { return tenantClusterTenant ? [{ clusterTenant: tenantClusterTenant }] : []; } },
  } as unknown as PrismaClient;
}

/** Build a minimal app mounting the metrics router with a canonical authenticated session. */
function _buildApp(prisma: PrismaClient, user: AuthUser | null = _authUser({ isPlatformOperator: true, isOrgAdmin: true })): Express
{
  const app = express();
  app.use(express.json());
  app.use(session({ secret: "test-session-secret", resave: false, saveUninitialized: false }));
  if (user)
  {
    app.use(function _seedSession(req, _res, next)
    {
      req.session.authUser = user;
      next();
    });
  }
  app.use("/api/v1/model-routing/metrics", modelRoutingMetricsRouter(prisma));
  return app;
}

/** Snapshot + clear the Langfuse env around each test so cases are isolated. */
const _ENV_KEYS = ["LANGFUSE_HOST", "LANGFUSE_PUBLIC_KEY", "LANGFUSE_SECRET_KEY", "LANGFUSE_METRICS_PATH"];

describe("modelRoutingMetricsRouter", function _suite()
{
  let saved: Record<string, string | undefined>;

  beforeEach(function _save()
  {
    saved = {};
    for (const k of _ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
  });

  afterEach(function _restore()
  {
    for (const k of _ENV_KEYS) { if (saved[k] === undefined) { delete process.env[k]; } else { process.env[k] = saved[k]; } }
    vi.restoreAllMocks();
  });

  it("returns 503 unconfigured when host/keys are missing", async function _unconfigured()
  {
    const res = await request(_buildApp(_mockPrisma())).get("/api/v1/model-routing/metrics");
    expect(res.status).toBe(503);
    expect(res.body.status).toBe("unconfigured");
  });

  it("proxies with server-side Basic auth and returns the upstream JSON (operator: no scope filter)", async function _proxy()
  {
    process.env.LANGFUSE_HOST = "https://lf.internal";
    process.env.LANGFUSE_PUBLIC_KEY = "pk";
    process.env.LANGFUSE_SECRET_KEY = "sk";

    const fetchMock = vi.fn(async function _f() { return { ok: true, status: 200, json: async function _j() { return { data: [{ count: 7 }] }; } } as unknown as Response; });
    vi.stubGlobal("fetch", fetchMock);

    const app = _buildApp(_mockPrisma(), _authUser({ sub: "operator-1", email: "op@platform.test", isPlatformOperator: true, isOrgAdmin: true }));
    const res = await request(app).get("/api/v1/model-routing/metrics").query({ query: JSON.stringify({ view: "traces", filters: [] }) });

    expect(res.status).toBe(200);
    expect(res.body.data[0].count).toBe(7);

    // Assert the upstream URL, Basic auth header, and that the operator query was NOT constrained.
    const [calledUrl, calledInit] = fetchMock.mock.calls[0] as unknown as [string, { headers: Record<string, string> }];
    expect(calledUrl).toContain("https://lf.internal/api/public/metrics");
    expect(calledInit.headers.Authorization).toBe(`Basic ${Buffer.from("pk:sk").toString("base64")}`);
    const forwarded = JSON.parse(new URL(calledUrl).searchParams.get("query")!);
    expect(forwarded.filters).toEqual([]);
  });

  it("injects a tenant-scope filter into the forwarded query for a non-operator", async function _scopeInject()
  {
    process.env.LANGFUSE_HOST = "https://lf.internal";
    process.env.LANGFUSE_PUBLIC_KEY = "pk";
    process.env.LANGFUSE_SECRET_KEY = "sk";

    const fetchMock = vi.fn(async function _f() { return { ok: true, status: 200, json: async function _j() { return {}; } } as unknown as Response; });
    vi.stubGlobal("fetch", fetchMock);

    const app = _buildApp(_mockPrisma("acme"), _authUser({ sub: "user-acme", email: "user@acme.test" }));
    await request(app).get("/api/v1/model-routing/metrics").query({ query: JSON.stringify({ view: "traces", filters: [] }) });

    const [calledUrl] = fetchMock.mock.calls[0] as unknown as [string];
    const forwarded = JSON.parse(new URL(calledUrl).searchParams.get("query")!);
    expect(forwarded.filters).toHaveLength(1);
    expect(forwarded.filters[0].value).toBe("acme");
    expect(forwarded.filters[0].column).toBe("metadata.clusterTenant");
  });

  it("returns 403 for a non-operator with no resolved ClusterTenant (fail-closed, no upstream call)", async function _failClosed()
  {
    process.env.LANGFUSE_HOST = "https://lf.internal";
    process.env.LANGFUSE_PUBLIC_KEY = "pk";
    process.env.LANGFUSE_SECRET_KEY = "sk";

    const fetchMock = vi.fn(async function _f() { return { ok: true, status: 200, json: async function _j() { return {}; } } as unknown as Response; });
    vi.stubGlobal("fetch", fetchMock);

    const app = _buildApp(_mockPrisma(null), _authUser({ sub: "user-nowhere", email: "nobody@nowhere.test" }));
    const res = await request(app).get("/api/v1/model-routing/metrics").query({ query: JSON.stringify({ view: "traces", filters: [] }) });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("FORBIDDEN_SCOPE");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 502 when the upstream call rejects", async function _upstreamError()
  {
    process.env.LANGFUSE_HOST = "https://lf.internal";
    process.env.LANGFUSE_PUBLIC_KEY = "pk";
    process.env.LANGFUSE_SECRET_KEY = "sk";

    vi.stubGlobal("fetch", vi.fn(async function _f() { throw new Error("ECONNREFUSED"); }));

    const res = await request(_buildApp(_mockPrisma())).get("/api/v1/model-routing/metrics");
    expect(res.status).toBe(502);
    expect(res.body.status).toBe("upstream_error");
  });

  it("returns 502 when the upstream responds non-2xx", async function _upstreamNon2xx()
  {
    process.env.LANGFUSE_HOST = "https://lf.internal";
    process.env.LANGFUSE_PUBLIC_KEY = "pk";
    process.env.LANGFUSE_SECRET_KEY = "sk";

    vi.stubGlobal("fetch", vi.fn(async function _f() { return { ok: false, status: 500, json: async function _j() { return {}; } } as unknown as Response; }));

    const res = await request(_buildApp(_mockPrisma())).get("/api/v1/model-routing/metrics");
    expect(res.status).toBe(502);
  });
});
