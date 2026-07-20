import express from "express";
import type { Express } from "express";
import type { PrismaClient } from "@prisma/client";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { mcpOperatorRouter } from "../routes/mcp-operator.js";

/**
 * Operator-API coverage (`/api/v1/mcp/*`): the org-admin gate on the governance
 * endpoints, published+entitled filtering of the catalogue, the
 * install→credential→connected lifecycle, and the custody invariant that NO
 * response ever serialises credential material.
 */

/** Auth env that decides `_IsDevAuthMode`; cleared/restored around each test. */
const _AUTH_ENV = ["OPENCRANE_API_TOKEN", "OIDC_ISSUER_URL", "OIDC_CLIENT_ID", "OIDC_CLIENT_SECRET", "OIDC_REDIRECT_URI", "OIDC_SESSION_SECRET"] as const;

/** Session user shape seeded onto the request (mirrors the OIDC session). */
interface _SessionUser
{
  /** Stable subject identifier. */
  sub?: string;
  /** Caller email (used when sub is absent). */
  email?: string;
  /** IdP group claims. */
  groups?: string[];
  /** Whether the IdP marked the caller an org admin. */
  isOrgAdmin?: boolean;
}

/**
 * Recording Prisma stub: every `prisma.<model>.<method>()` resolves to `[]` and is
 * a memoised spy, unless an explicit override is supplied for `model.method`.
 *
 * @param overrides - Per-`model.method` implementations to install.
 * @returns The stubbed client plus the spy registry.
 */
function _mockPrisma(overrides: Record<string, (...args: unknown[]) => unknown> = {}): { prisma: PrismaClient; spies: Record<string, ReturnType<typeof vi.fn>> }
{
  const spies: Record<string, ReturnType<typeof vi.fn>> = {};
  const prisma = new Proxy({}, {
    get(_t, model)
    {
      return new Proxy({}, {
        get(_t2, method)
        {
          const key = `${String(model)}.${String(method)}`;
          if (!spies[key])
          {
            spies[key] = overrides[key] ? vi.fn(overrides[key]) : vi.fn().mockResolvedValue([]);
          }
          return spies[key];
        },
      });
    },
  }) as unknown as PrismaClient;
  return { prisma, spies };
}

/** Mount the operator router, optionally seeding a session user. */
function _buildApp(prisma: PrismaClient, user?: _SessionUser): Express
{
  const app = express();
  app.use(express.json());
  if (user)
  {
    app.use(function _seedSession(req, _res, next) { (req as unknown as { session: { authUser: _SessionUser } }).session = { authUser: user }; next(); });
  }
  app.use("/api/v1/mcp", mcpOperatorRouter(prisma));
  return app;
}

describe("mcp-operator router", function _suite()
{
  const _saved: Record<string, string | undefined> = {};

  /** Snapshot then clear the auth env so each case controls the dev-mode posture. */
  beforeEach(function _clearEnv()
  {
    for (const key of _AUTH_ENV) { _saved[key] = process.env[key]; delete process.env[key]; }
  });

  /** Restore the auth env captured in `beforeEach` so cases stay isolated. */
  afterEach(function _restoreEnv()
  {
    for (const key of _AUTH_ENV) { if (_saved[key] === undefined) { delete process.env[key]; } else { process.env[key] = _saved[key]; } }
  });

  describe("org-admin gate on governance endpoints", function _gate()
  {
    it("denies GET /servers for a non-admin session", async function _denyList()
    {
      process.env.OPENCRANE_API_TOKEN = "ci-token";
      const { prisma, spies } = _mockPrisma();
      const res = await request(_buildApp(prisma, { sub: "u1", isOrgAdmin: false })).get("/api/v1/mcp/servers");

      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ code: "FORBIDDEN_NOT_ORG_ADMIN" });
      expect(spies["mcpServer.findMany"]).toBeUndefined();
    });

    it("denies PUT /servers/:id/access for a non-admin session", async function _denyAccess()
    {
      process.env.OPENCRANE_API_TOKEN = "ci-token";
      const { prisma, spies } = _mockPrisma();
      const res = await request(_buildApp(prisma, { sub: "u1", isOrgAdmin: false }))
        .put("/api/v1/mcp/servers/srv-1/access").send({ everyoneInOrg: true, groups: [], users: [] });

      expect(res.status).toBe(403);
      expect(spies["mcpServerAccessPolicy.upsert"]).toBeUndefined();
    });

    it("denies GET /directory for a non-admin session", async function _denyDirectory()
    {
      process.env.OPENCRANE_API_TOKEN = "ci-token";
      const { prisma } = _mockPrisma();
      const res = await request(_buildApp(prisma, { sub: "u1", isOrgAdmin: false })).get("/api/v1/mcp/directory");

      expect(res.status).toBe(403);
    });

    it("lets an org-admin session through GET /servers to the handler", async function _allowList()
    {
      process.env.OPENCRANE_API_TOKEN = "ci-token";
      const { prisma, spies } = _mockPrisma();
      const res = await request(_buildApp(prisma, { sub: "admin", isOrgAdmin: true })).get("/api/v1/mcp/servers");

      expect(res.status).not.toBe(403);
      expect(spies["mcpServer.findMany"]).toHaveBeenCalled();
    });

    it("opens the gate under dev mode when no session and no real auth", async function _devOpen()
    {
      const { prisma } = _mockPrisma();
      const res = await request(_buildApp(prisma)).get("/api/v1/mcp/servers");

      expect(res.status).not.toBe(403);
    });
  });

  describe("GET /catalog — published + entitled filtering", function _catalog()
  {
    /** Two published servers: one org-wide entitled, one only for another user. */
    const _servers = [
      { id: "srv-open", name: "Open", description: "", publisher: null, glyph: null, serverType: "MultiUser", approvalStatus: "Published", credentialSchema: [], entitlementSummary: null, createdAt: new Date(), accessPolicy: { everyoneInOrg: true, groups: [], users: [] } },
      { id: "srv-closed", name: "Closed", description: "", publisher: null, glyph: null, serverType: "SingleUser", approvalStatus: "Published", credentialSchema: [], entitlementSummary: null, createdAt: new Date(), accessPolicy: { everyoneInOrg: false, groups: ["other-group"], users: [{ userId: "someone-else" }] } },
    ];

    it("returns only the servers the caller is entitled to", async function _filters()
    {
      process.env.OPENCRANE_API_TOKEN = "ci-token";
      const { prisma } = _mockPrisma({ "mcpServer.findMany": function _findMany() { return Promise.resolve(_servers); } });
      const res = await request(_buildApp(prisma, { sub: "user-1", groups: [], isOrgAdmin: false })).get("/api/v1/mcp/catalog");

      expect(res.status).toBe(200);
      expect(res.body.map(function _id(s: { id: string }) { return s.id; })).toEqual(["srv-open"]);
      expect(res.body[0]).toMatchObject({ id: "srv-open", type: "multi-user", approvalStatus: "published" });
    });

    it("entitles a caller via a matching group claim", async function _group()
    {
      process.env.OPENCRANE_API_TOKEN = "ci-token";
      const { prisma } = _mockPrisma({ "mcpServer.findMany": function _findMany() { return Promise.resolve(_servers); } });
      const res = await request(_buildApp(prisma, { sub: "user-2", groups: ["other-group"], isOrgAdmin: false })).get("/api/v1/mcp/catalog");

      expect(res.status).toBe(200);
      expect(res.body.map(function _id(s: { id: string }) { return s.id; }).sort()).toEqual(["srv-closed", "srv-open"]);
    });
  });

  describe("install → credential → connected lifecycle", function _lifecycle()
  {
    /**
     * Stateful single-install store backing the connect mutations, so a request can
     * observe the connection-status transition a real DB would persist.
     */
    function _statefulPrisma(serverType: string): { prisma: PrismaClient; store: { install: Record<string, unknown> | null } }
    {
      const store: { install: Record<string, unknown> | null } = { install: null };
      const overrides: Record<string, (...args: unknown[]) => unknown> = {
        "mcpServer.findUnique": function _serverFind() { return Promise.resolve({ serverType }); },
        "mcpServerInstall.findUnique": function _installFind() { return Promise.resolve(store.install); },
        "mcpServerInstall.upsert": function _upsert(arg: unknown) {
          const create = (arg as { create: Record<string, unknown> }).create;
          store.install ??= { mcpServerId: create.mcpServerId, userId: create.userId, connectionStatus: create.connectionStatus ?? "NeedsCredential", credentialRef: null, connectedAccount: null, lastUsedAt: null };
          return Promise.resolve(store.install);
        },
        "mcpServerInstall.update": function _update(arg: unknown) {
          const data = (arg as { data: Record<string, unknown> }).data;
          store.install = { ...(store.install ?? {}), ...data };
          return Promise.resolve(store.install);
        },
        "auditEntry.create": function _audit() { return Promise.resolve({}); },
      };
      const { prisma } = _mockPrisma(overrides);
      return { prisma, store };
    }

    it("installs a single-user server as needs-credential", async function _install()
    {
      const { prisma } = _statefulPrisma("SingleUser");
      const res = await request(_buildApp(prisma, { sub: "user-1" })).post("/api/v1/mcp/installed").send({ serverId: "srv-1" });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ serverId: "srv-1", connectionStatus: "needs-credential" });
    });

    it("installs a multi-user server as shared-key", async function _installShared()
    {
      const { prisma } = _statefulPrisma("MultiUser");
      const res = await request(_buildApp(prisma, { sub: "user-1" })).post("/api/v1/mcp/installed").send({ serverId: "srv-1" });

      expect(res.status).toBe(201);
      expect(res.body.connectionStatus).toBe("shared-key");
    });

    it("transitions to connected when a credential is authored", async function _connect()
    {
      const { prisma, store } = _statefulPrisma("SingleUser");
      store.install = { mcpServerId: "srv-1", userId: "user-1", connectionStatus: "NeedsCredential", credentialRef: null, connectedAccount: null, lastUsedAt: null };
      const res = await request(_buildApp(prisma, { sub: "user-1" }))
        .put("/api/v1/mcp/installed/srv-1/credential").send({ values: { apiKey: "SUPER-SECRET-123" } });

      expect(res.status).toBe(200);
      expect(res.body.connectionStatus).toBe("connected");
    });

    it("returns 404 when authoring a credential for an uninstalled server", async function _noInstall()
    {
      const { prisma } = _statefulPrisma("SingleUser");
      const res = await request(_buildApp(prisma, { sub: "user-1" }))
        .put("/api/v1/mcp/installed/srv-1/credential").send({ values: { apiKey: "x" } });

      expect(res.status).toBe(404);
    });
  });

  describe("user-scoping — a caller only sees / acts on their own installs", function _scoping()
  {
    it("scopes GET /installed to the calling user's id", async function _listScoped()
    {
      const { prisma, spies } = _mockPrisma({ "mcpServerInstall.findMany": function _f() { return Promise.resolve([]); } });
      await request(_buildApp(prisma, { sub: "caller-9" })).get("/api/v1/mcp/installed");

      expect(spies["mcpServerInstall.findMany"]).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: "caller-9" } }));
    });

    it("scopes DELETE /installed/:serverId to the calling user's id", async function _deleteScoped()
    {
      const { prisma, spies } = _mockPrisma({
        "mcpServerInstall.deleteMany": function _d() { return Promise.resolve({ count: 1 }); },
        "auditEntry.create": function _a() { return Promise.resolve({}); },
      });
      const res = await request(_buildApp(prisma, { sub: "caller-9" })).delete("/api/v1/mcp/installed/srv-1");

      expect(res.status).toBe(204);
      expect(spies["mcpServerInstall.deleteMany"]).toHaveBeenCalledWith({ where: { mcpServerId: "srv-1", userId: "caller-9" } });
    });
  });

  describe("credential custody — no response serialises secret material", function _custody()
  {
    it("never echoes the submitted credential values or the credentialRef", async function _writeOnly()
    {
      const store: { install: Record<string, unknown> | null } = { install: { mcpServerId: "srv-1", userId: "user-1", connectionStatus: "NeedsCredential", credentialRef: null, connectedAccount: null, lastUsedAt: null } };
      const { prisma } = _mockPrisma({
        "mcpServerInstall.findUnique": function _f() { return Promise.resolve(store.install); },
        "mcpServerInstall.update": function _u(arg: unknown) { store.install = { ...(store.install ?? {}), ...(arg as { data: Record<string, unknown> }).data }; return Promise.resolve(store.install); },
        "auditEntry.create": function _a() { return Promise.resolve({}); },
      });
      const res = await request(_buildApp(prisma, { sub: "user-1" }))
        .put("/api/v1/mcp/installed/srv-1/credential").send({ values: { apiKey: "SUPER-SECRET-123", token: "t0ps3cret" } });

      expect(res.status).toBe(200);
      const serialised = JSON.stringify(res.body);
      expect(serialised).not.toContain("SUPER-SECRET-123");
      expect(serialised).not.toContain("t0ps3cret");
      expect(serialised).not.toContain("credentialRef");
      expect(serialised).not.toContain("cred_");
      expect(Object.keys(res.body).sort()).toEqual(["connectionStatus", "lastUsed", "serverId"]);
    });
  });
});
