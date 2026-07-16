import express from "express";
import type { Express } from "express";
import type { PrismaClient } from "@prisma/client";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { thirdPartySourcesRouter } from "../routes/third-party-sources.js";

/**
 * Authorization + approval gate on the external-registry discovery/import surface
 * (italanta/opencrane#128 review). The registry capability is org-admin only, and an
 * import additionally requires the source to be approved (past pending-approval).
 */

/** Auth env that decides `_IsDevAuthMode`; cleared/restored around each test. */
const _AUTH_ENV = ["OPENCRANE_API_TOKEN", "OIDC_ISSUER_URL", "OIDC_CLIENT_ID", "OIDC_CLIENT_SECRET", "OIDC_REDIRECT_URI", "OIDC_SESSION_SECRET"] as const;

/** Session user shape seeded onto the request (mirrors the OIDC session). */
interface _SessionUser
{
  sub?: string;
  isOrgAdmin?: boolean;
}

/** Mount the router with a stub prisma exposing only `thirdPartySource.findUnique`. */
function _buildApp(source: Record<string, unknown> | null, user?: _SessionUser): Express
{
  const prisma = { thirdPartySource: { findUnique: async function _f() { return source; } } } as unknown as PrismaClient;
  const app = express();
  app.use(express.json());
  if (user)
  {
    app.use(function _seed(req, _res, next) { (req as unknown as { session: { authUser: _SessionUser } }).session = { authUser: user }; next(); });
  }
  app.use("/api/v1/third-party-sources", thirdPartySourcesRouter(prisma));
  return app;
}

describe("third-party-sources — registry authz + approval gate", function _suite()
{
  const _saved: Record<string, string | undefined> = {};
  beforeEach(function _clear() { for (const k of _AUTH_ENV) { _saved[k] = process.env[k]; delete process.env[k]; } });
  afterEach(function _restore() { for (const k of _AUTH_ENV) { if (_saved[k] === undefined) { delete process.env[k]; } else { process.env[k] = _saved[k]; } } });

  it("denies import for a non-admin session under real auth (403), before any registry work", async function _denyNonAdmin()
  {
    process.env.OPENCRANE_API_TOKEN = "ci-token";
    const res = await request(_buildApp({ kind: "McpRegistry", originUrl: "https://registry.example", status: "healthy" }, { sub: "u1", isOrgAdmin: false }))
      .post("/api/v1/third-party-sources/src-1/import").send({ upstreamName: "x", pinnedVersion: "1", remoteUrl: "https://evil.example", obotCatalogId: "c" });

    expect(res.status).toBe(403);
  });

  it("denies discovery for a non-admin session under real auth (403)", async function _denyDiscover()
  {
    process.env.OPENCRANE_API_TOKEN = "ci-token";
    const res = await request(_buildApp({ kind: "McpRegistry", originUrl: "https://registry.example", status: "healthy" }, { sub: "u1", isOrgAdmin: false }))
      .get("/api/v1/third-party-sources/src-1/discover");

    expect(res.status).toBe(403);
  });

  it("rejects import from a source still pending approval (409), even for an admin", async function _pending()
  {
    process.env.OPENCRANE_API_TOKEN = "ci-token";
    const res = await request(_buildApp({ kind: "McpRegistry", originUrl: "https://registry.example", status: "pending-approval" }, { sub: "admin", isOrgAdmin: true }))
      .post("/api/v1/third-party-sources/src-1/import").send({ upstreamName: "x", pinnedVersion: "1", remoteUrl: "https://registry.example/x", obotCatalogId: "c" });

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: "SOURCE_PENDING_APPROVAL" });
  });
});
