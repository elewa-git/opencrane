import express from "express";
import type { Express } from "express";
import type { PrismaClient } from "@prisma/client";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { groupsRouter } from "../routes/groups.js";

/**
 * End-to-end check that `_RequireOrgAdmin` is actually wired onto the groups API
 * mutation routes: create/update/delete are org-admin-only, reads stay open.
 *
 * This test verifies the mitigation for the pentest finding:
 * "Any authenticated user can delete arbitrary groups by ID"
 *
 * The fix adds `_RequireOrgAdmin()` middleware to POST, PUT, and DELETE routes,
 * ensuring only organization administrators can mutate groups (which are used for
 * access control and sharing). Read operations (GET) remain available to all
 * authenticated users for sharing and entitlement selection.
 */

/** OIDC environment isolated so authentication configuration cannot leak between tests. */
const _AUTH_ENV = ["OIDC_ISSUER_URL", "OIDC_CLIENT_ID", "OIDC_CLIENT_SECRET", "OIDC_REDIRECT_URI", "OIDC_SESSION_SECRET"] as const;

/** Configure a complete OIDC setup so no-session guards must fail closed. */
function _enableOidc(): void
{
  process.env.OIDC_ISSUER_URL = "https://issuer.example.test";
  process.env.OIDC_CLIENT_ID = "opencrane";
  process.env.OIDC_REDIRECT_URI = "https://opencrane.example.test/auth/callback";
  process.env.OIDC_SESSION_SECRET = "test-session-secret";
}

/**
 * Recording Prisma stub: every `prisma.<model>.<method>()` resolves to `[]` and is a
 * memoised spy keyed `model.method`, so a test can assert which calls the handler made
 * (e.g. that a denied request never reached `group.delete`).
 */
function _mockPrisma(): { prisma: PrismaClient; spies: Record<string, ReturnType<typeof vi.fn>> }
{
  const spies: Record<string, ReturnType<typeof vi.fn>> = {};
  const prisma = new Proxy({}, {
    get(_t, model)
    {
      if (model === "$transaction")
      {
        return async function _transaction(callback: (transaction: PrismaClient) => Promise<unknown>): Promise<unknown>
        {
          return callback(prisma as PrismaClient);
        };
      }
      return new Proxy({}, {
        get(_t2, method)
        {
          const key = `${String(model)}.${String(method)}`;
          return (spies[key] ??= vi.fn().mockResolvedValue([]));
        },
      });
    },
  }) as unknown as PrismaClient;
  return { prisma, spies };
}

/** Mount the router, optionally seeding a session user (mirrors the OIDC session shape). */
function _buildApp(prisma: PrismaClient, user?: { isOrgAdmin: boolean }): Express
{
  const app = express();
  app.use(express.json());
  if (user)
  {
    app.use(function _seedSession(req, _res, next) { (req as unknown as { session: { authUser: { isOrgAdmin: boolean } } }).session = { authUser: user }; next(); });
  }
  app.use("/api/v1/groups", groupsRouter(prisma));
  return app;
}

describe("groups router — _RequireOrgAdmin gate (pentest mitigation)", function _suite()
{
  const _saved: Record<string, string | undefined> = {};

  /** Snapshot then clear the auth env so each case controls the dev-mode/fail-closed posture. */
  beforeEach(function _clearEnv()
  {
    for (const key of _AUTH_ENV) { _saved[key] = process.env[key]; delete process.env[key]; }
  });

  /** Restore the auth env captured in `beforeEach` so cases stay isolated. */
  afterEach(function _restoreEnv()
  {
    for (const key of _AUTH_ENV) { if (_saved[key] === undefined) { delete process.env[key]; } else { process.env[key] = _saved[key]; } }
  });

  // -------------------------------------------------------------------------
  // Read operations — should remain open to all authenticated users
  // -------------------------------------------------------------------------

  it("allows list for a non-admin session (GET / is not gated)", async function _listOpen()
  {
    const { prisma, spies } = _mockPrisma();
    const res = await request(_buildApp(prisma, { isOrgAdmin: false })).get("/api/v1/groups");

    expect(res.status).toBe(200);
    expect(spies["group.findMany"]).toHaveBeenCalled();
  });

  it("allows get by ID for a non-admin session (GET /:id is not gated)", async function _getOpen()
  {
    const { prisma, spies } = _mockPrisma();
    // Mock findUnique to return a group so we don't get 404
    spies["group.findUnique"] = vi.fn().mockResolvedValue({ id: "grp-1", name: "Test Group", scope: "Org", members: [] });
    
    const res = await request(_buildApp(prisma, { isOrgAdmin: false })).get("/api/v1/groups/grp-1");

    expect(res.status).toBe(200);
    expect(spies["group.findUnique"]).toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Mutation operations — should be blocked for non-admin users
  // -------------------------------------------------------------------------

  it("denies create for a non-admin session and never reaches the handler", async function _denyCreate()
  {
    const { prisma, spies } = _mockPrisma();
    const res = await request(_buildApp(prisma, { isOrgAdmin: false }))
      .post("/api/v1/groups")
      .send({ name: "New Group", scope: "org", members: [] });

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ code: "FORBIDDEN_NOT_ORG_ADMIN" });
    expect(spies["group.create"]).toBeUndefined();
  });

  it("denies update for a non-admin session and never reaches the handler", async function _denyUpdate()
  {
    const { prisma, spies } = _mockPrisma();
    const res = await request(_buildApp(prisma, { isOrgAdmin: false }))
      .put("/api/v1/groups/grp-1")
      .send({ name: "Updated Name" });

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ code: "FORBIDDEN_NOT_ORG_ADMIN" });
    expect(spies["group.update"]).toBeUndefined();
  });

  it("denies delete for a non-admin session and never reaches the handler", async function _denyDelete()
  {
    const { prisma, spies } = _mockPrisma();
    const res = await request(_buildApp(prisma, { isOrgAdmin: false }))
      .delete("/api/v1/groups/grp-1");

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ code: "FORBIDDEN_NOT_ORG_ADMIN" });
    expect(spies["group.delete"]).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // Exploit scenario: authenticated user attempts to delete arbitrary group
  // -------------------------------------------------------------------------

  it("blocks the pentest exploit: authenticated non-admin cannot delete arbitrary groups by ID", async function _blockExploit()
  {
    const { prisma, spies } = _mockPrisma();
    
    // Simulate the pentest scenario:
    // 1. Attacker has valid session (isOrgAdmin: false)
    // 2. Attacker enumerates group IDs via GET /
    // 3. Attacker attempts to delete a group they don't own
    
    const app = _buildApp(prisma, { isOrgAdmin: false });
    
    // Step 1: List groups (should succeed - needed for sharing UI)
    const listRes = await request(app).get("/api/v1/groups");
    expect(listRes.status).toBe(200);
    
    // Step 2: Attempt to delete an arbitrary group (should fail)
    const deleteRes = await request(app).delete("/api/v1/groups/grp-victim-123");
    
    // Verify the exploit is blocked
    expect(deleteRes.status).toBe(403);
    expect(deleteRes.body.code).toBe("FORBIDDEN_NOT_ORG_ADMIN");
    
    // Verify the delete operation never reached the database
    expect(spies["group.delete"]).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // Org admin operations — should be allowed
  // -------------------------------------------------------------------------

  it("lets an org-admin session through the create gate to the handler", async function _allowCreate()
  {
    const { prisma, spies } = _mockPrisma();
    const res = await request(_buildApp(prisma, { isOrgAdmin: true }))
      .post("/api/v1/groups")
      .send({ name: "Admin Group", scope: "org", members: [] });

    expect(res.status).not.toBe(403);
    expect(spies["group.create"]).toHaveBeenCalled();
  });

  it("lets an org-admin session through the update gate to the handler", async function _allowUpdate()
  {
    const { prisma, spies } = _mockPrisma();
    const res = await request(_buildApp(prisma, { isOrgAdmin: true }))
      .put("/api/v1/groups/grp-1")
      .send({ name: "Updated by Admin" });

    expect(res.status).not.toBe(403);
    expect(spies["group.update"]).toHaveBeenCalled();
  });

  it("lets an org-admin session through the delete gate to the handler", async function _allowDelete()
  {
    const { prisma, spies } = _mockPrisma();
    const res = await request(_buildApp(prisma, { isOrgAdmin: true }))
      .delete("/api/v1/groups/grp-1");

    expect(res.status).not.toBe(403);
    expect(spies["group.delete"]).toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Unauthenticated access — should be blocked
  // -------------------------------------------------------------------------

  it("fails closed when no session is established (delete)", async function _denyUnauthenticatedDelete()
  {
    const { prisma, spies } = _mockPrisma();
    const res = await request(_buildApp(prisma)).delete("/api/v1/groups/grp-1");

    expect(res.status).toBe(403);
    expect(spies["group.delete"]).toBeUndefined();
  });

  it("fails closed when no session is established (create)", async function _denyUnauthenticatedCreate()
  {
    const { prisma, spies } = _mockPrisma();
    const res = await request(_buildApp(prisma))
      .post("/api/v1/groups")
      .send({ name: "Unauthenticated Group", scope: "org", members: [] });

    expect(res.status).toBe(403);
    expect(spies["group.create"]).toBeUndefined();
  });

  it("fails closed when no session is established (update)", async function _denyUnauthenticatedUpdate()
  {
    const { prisma, spies } = _mockPrisma();
    const res = await request(_buildApp(prisma))
      .put("/api/v1/groups/grp-1")
      .send({ name: "Unauthenticated Update" });

    expect(res.status).toBe(403);
    expect(spies["group.update"]).toBeUndefined();
  });

  it("fails closed for an unauthenticated mutation when real auth is configured", async function _failClosed()
  {
    _enableOidc();
    const { prisma, spies } = _mockPrisma();
    const res = await request(_buildApp(prisma)).delete("/api/v1/groups/grp-1");

    expect(res.status).toBe(403);
    expect(spies["group.delete"]).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // Security property: consistent 403 response
  // -------------------------------------------------------------------------

  it("returns identical 403 response for no-session and non-admin session", async function _consistentDenial()
  {
    const { prisma: prisma1 } = _mockPrisma();
    const { prisma: prisma2 } = _mockPrisma();
    
    const noSessionRes = await request(_buildApp(prisma1)).delete("/api/v1/groups/grp-1");
    const nonAdminRes = await request(_buildApp(prisma2, { isOrgAdmin: false })).delete("/api/v1/groups/grp-1");

    // Both should return 403 with the same error code
    expect(noSessionRes.status).toBe(403);
    expect(nonAdminRes.status).toBe(403);
    expect(noSessionRes.body.code).toBe("FORBIDDEN_NOT_ORG_ADMIN");
    expect(nonAdminRes.body.code).toBe("FORBIDDEN_NOT_ORG_ADMIN");
    
    // The error message should be identical (security property: no information leakage)
    expect(noSessionRes.body.error).toBe(nonAdminRes.body.error);
  });
});
