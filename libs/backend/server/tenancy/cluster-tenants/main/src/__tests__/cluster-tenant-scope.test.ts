import type { Request, Response } from "express";
import type { PrismaClient } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { _ClusterTenantScopeGuard } from "../middleware/cluster-tenant-scope.js";
import type { ClusterTenantScopedResource } from "../middleware/cluster-tenant-scope.types.js";

/** Minimal OIDC env so the guard runs in real-auth mode (no dev-mode fail-open). */
function _enableOidc(): void
{
  process.env.OIDC_ISSUER_URL = "https://idp.test";
  process.env.OIDC_CLIENT_ID = "cid";
  process.env.OIDC_REDIRECT_URI = "https://cp.test/api/v1/auth/callback";
  process.env.OIDC_SESSION_SECRET = "test-secret";
}

/** Clear the OIDC env between tests so config does not leak across cases. */
function _disableOidc(): void
{
  delete process.env.OIDC_ISSUER_URL;
  delete process.env.OIDC_CLIENT_ID;
  delete process.env.OIDC_REDIRECT_URI;
  delete process.env.OIDC_SESSION_SECRET;
}

/** Build a Request carrying the given session user (or none). */
function _req(authUser: Record<string, unknown> | undefined): Request
{
  return { session: authUser ? { authUser } : {} } as unknown as Request;
}

/** A non-operator human session. */
function _human(email: string): Record<string, unknown>
{
  return { sub: "u-1", issuer: "https://idp.test", groups: [], isPlatformOperator: false, isOrgAdmin: false, email };
}

/** Run the guard and resolve to the decision it took (`allow` via next, `deny` via 403 json). */
function _decide(
  prisma: PrismaClient,
  resource: ClusterTenantScopedResource | null,
  req: Request,
): Promise<{ decision: "allow" | "deny"; status?: number }>
{
  return new Promise(function _exec(resolve)
  {
    const handler = _ClusterTenantScopeGuard(prisma, async function _resolve() { return resource; });
    let statusCode: number | undefined;
    const res = {
      status(code: number) { statusCode = code; return res; },
      json() { resolve({ decision: "deny", status: statusCode }); return res; },
    } as unknown as Response;
    handler(req, res, function _next() { resolve({ decision: "allow" }); });
  });
}

/** Prisma stub whose tenant.findMany echoes a configurable row set. */
function _prismaWith(rows: { clusterTenantRef: string | null }[]): { prisma: PrismaClient; findMany: ReturnType<typeof vi.fn> }
{
  const findMany = vi.fn().mockResolvedValue(rows);
  return { prisma: { tenant: { findMany } } as unknown as PrismaClient, findMany };
}

describe("_ClusterTenantScopeGuard — silo-scoped mutation authz (AIR.0b)", function _suite()
{
  beforeEach(_enableOidc);
  afterEach(function _reset() { _disableOidc(); vi.restoreAllMocks(); });

  it("allows a platform operator without resolving any tenant", async function _operator()
  {
    const { prisma, findMany } = _prismaWith([]);
    const result = await _decide(prisma, { scope: "clusterTenant", clusterTenant: "acme" }, _req({ isPlatformOperator: true, email: "op@x.io" }));

    expect(result.decision).toBe("allow");
    expect(findMany).not.toHaveBeenCalled();
  });

  it("fails closed (deny) for a missing session under real auth", async function _noSession()
  {
    const { prisma } = _prismaWith([]);
    const result = await _decide(prisma, { scope: "clusterTenant", clusterTenant: "acme" }, _req(undefined));

    expect(result.decision).toBe("deny");
    expect(result.status).toBe(403);
  });

  it("denies a non-operator a global-scoped mutation", async function _global()
  {
    const { prisma, findMany } = _prismaWith([{ clusterTenantRef: "acme" }]);
    const result = await _decide(prisma, { scope: "global", clusterTenant: null }, _req(_human("owner@acme.io")));

    expect(result.decision).toBe("deny");
    expect(findMany).not.toHaveBeenCalled();
  });

  it("allows a multi-silo owner to mutate a resource in a silo they own, scoping the lookup to it", async function _ownerScoped()
  {
    // Owner of several silos: an unscoped email match would be ambiguous, but the guard scopes the
    // lookup to the targeted silo so exactly the owned row matches.
    const { prisma, findMany } = _prismaWith([{ clusterTenantRef: "elewa-be" }]);
    const result = await _decide(prisma, { scope: "clusterTenant", clusterTenant: "elewa-be" }, _req(_human("jente@elewa.ke")));

    expect(result.decision).toBe("allow");
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { email: { equals: "jente@elewa.ke", mode: "insensitive" }, clusterTenantRef: "elewa-be" },
      take: 2,
    }));
  });

  it("denies a non-owner whose scoped lookup yields no row in the targeted silo", async function _foreign()
  {
    const { prisma } = _prismaWith([]);
    const result = await _decide(prisma, { scope: "clusterTenant", clusterTenant: "northwind" }, _req(_human("jente@elewa.ke")));

    expect(result.decision).toBe("deny");
    expect(result.status).toBe(403);
  });
});
