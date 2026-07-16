import express from "express";
import type { Express } from "express";
import type { PrismaClient } from "@prisma/client";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { mcpOperatorRouter } from "../routes/mcp-operator.js";
import type { ObotManagementClient } from "../core/obot-client.types.js";

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
function _buildApp(prisma: PrismaClient, user?: _SessionUser, obot?: ObotManagementClient): Express
{
  const app = express();
  app.use(express.json());
  if (user)
  {
    app.use(function _seedSession(req, _res, next) { (req as unknown as { session: { authUser: _SessionUser } }).session = { authUser: user }; next(); });
  }
  app.use("/api/v1/mcp", obot ? mcpOperatorRouter(prisma, obot) : mcpOperatorRouter(prisma));
  return app;
}

/**
 * A mock Obot management client that reports every server `configured` — the happy
 * path where a real credential configure/OAuth reconcile succeeds. Only the two
 * methods the credential routes call are implemented; the rest throw so an
 * unexpected call is loud.
 */
function _stubObotConfigured(): ObotManagementClient
{
  const _notCalled = function _n(): never { throw new Error("unexpected Obot call in this test"); };
  return {
    configureServer: async function _c() { return { readiness: "configured", connectUrl: "https://obot.example/connect/abc", transport: "streamable-http" }; },
    getServerState: async function _g() { return { readiness: "configured", connectUrl: "https://obot.example/connect/abc", transport: "streamable-http" }; },
    upsertCatalogEntry: _notCalled,
    createServer: _notCalled,
    reconcileAccess: _notCalled,
    listTools: _notCalled,
    deleteServer: _notCalled,
    mintClientToken: _notCalled,
    revokeClientToken: _notCalled,
  };
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

  describe("GET /catalog — entitlement derived from the generic Grant table (authority)", function _catalog()
  {
    /**
     * Two published servers. Crucially the rows carry NO `accessPolicy` include:
     * the decision is derived solely from `grant.findMany`, proving the demoted
     * McpServerAccessPolicy table is no longer the read authority.
     */
    const _servers = [
      { id: "srv-open", name: "Open", description: "", publisher: null, glyph: null, serverType: "MultiUser", approvalStatus: "Published", credentialSchema: [], entitlementSummary: null, createdAt: new Date() },
      { id: "srv-closed", name: "Closed", description: "", publisher: null, glyph: null, serverType: "SingleUser", approvalStatus: "Published", credentialSchema: [], entitlementSummary: null, createdAt: new Date() },
    ];

    /** A generic MCP Grant row in the shape `_CompileEntitledMcpServerIds` selects. */
    function _grant(overrides: Partial<{ payloadId: string; access: string; priority: number; subjectId: string; createdAt: Date }>): Record<string, unknown>
    {
      return { payloadId: "srv-open", access: "Allow", priority: 0, subjectId: "", createdAt: new Date(), ...overrides };
    }

    /**
     * Stub `grant.findMany` so it honours the `where.subjectId.in` filter the read
     * path builds — this is what makes claim-based group / org-wide matching real
     * rather than "any row present wins".
     */
    function _grantsFindMany(rows: Record<string, unknown>[]): (arg: unknown) => Promise<Record<string, unknown>[]>
    {
      return function _find(arg: unknown)
      {
        const inSet = ((arg as { where?: { subjectId?: { in?: string[] } } })?.where?.subjectId?.in) ?? [];
        return Promise.resolve(rows.filter(function _match(row) { return inSet.includes(row.subjectId as string); }));
      };
    }

    it("default-deny: an ungranted caller sees nothing", async function _deny()
    {
      process.env.OPENCRANE_API_TOKEN = "ci-token";
      const { prisma } = _mockPrisma({ "mcpServer.findMany": function _findMany() { return Promise.resolve(_servers); } });
      const res = await request(_buildApp(prisma, { sub: "user-1", groups: [], isOrgAdmin: false })).get("/api/v1/mcp/catalog");

      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it("an org-wide Grant entitles every caller", async function _orgWide()
    {
      process.env.OPENCRANE_API_TOKEN = "ci-token";
      const { prisma } = _mockPrisma({
        "mcpServer.findMany": function _findMany() { return Promise.resolve(_servers); },
        "grant.findMany": _grantsFindMany([_grant({ payloadId: "srv-open", subjectId: "*" })]),
      });
      const res = await request(_buildApp(prisma, { sub: "nobody-in-particular", groups: [], isOrgAdmin: false })).get("/api/v1/mcp/catalog");

      expect(res.status).toBe(200);
      expect(res.body.map(function _id(s: { id: string }) { return s.id; })).toEqual(["srv-open"]);
      expect(res.body[0]).toMatchObject({ id: "srv-open", type: "multi-user", approvalStatus: "published" });
    });

    it("a direct user Grant entitles that caller only", async function _user()
    {
      process.env.OPENCRANE_API_TOKEN = "ci-token";
      const { prisma } = _mockPrisma({
        "mcpServer.findMany": function _findMany() { return Promise.resolve(_servers); },
        "grant.findMany": _grantsFindMany([_grant({ payloadId: "srv-open", subjectId: "user-1" })]),
      });
      const entitled = await request(_buildApp(prisma, { sub: "user-1", groups: [], isOrgAdmin: false })).get("/api/v1/mcp/catalog");
      const other = await request(_buildApp(prisma, { sub: "user-2", groups: [], isOrgAdmin: false })).get("/api/v1/mcp/catalog");

      expect(entitled.body.map(function _id(s: { id: string }) { return s.id; })).toEqual(["srv-open"]);
      expect(other.body).toEqual([]);
    });

    it("entitles a caller via a matching group claim", async function _group()
    {
      process.env.OPENCRANE_API_TOKEN = "ci-token";
      const { prisma } = _mockPrisma({
        "mcpServer.findMany": function _findMany() { return Promise.resolve(_servers); },
        "grant.findMany": _grantsFindMany([_grant({ payloadId: "srv-closed", subjectId: "other-group" })]),
      });
      const member = await request(_buildApp(prisma, { sub: "user-2", groups: ["other-group"], isOrgAdmin: false })).get("/api/v1/mcp/catalog");
      const nonMember = await request(_buildApp(prisma, { sub: "user-3", groups: ["some-other"], isOrgAdmin: false })).get("/api/v1/mcp/catalog");

      expect(member.body.map(function _id(s: { id: string }) { return s.id; })).toEqual(["srv-closed"]);
      expect(nonMember.body).toEqual([]);
    });

    it("a Deny beats an Allow at equal priority (fail-closed precedence)", async function _deniedWins()
    {
      process.env.OPENCRANE_API_TOKEN = "ci-token";
      const { prisma } = _mockPrisma({
        "mcpServer.findMany": function _findMany() { return Promise.resolve(_servers); },
        "grant.findMany": _grantsFindMany([
          _grant({ payloadId: "srv-open", access: "Allow", subjectId: "user-1" }),
          _grant({ payloadId: "srv-open", access: "Deny", subjectId: "user-1" }),
        ]),
      });
      const res = await request(_buildApp(prisma, { sub: "user-1", groups: [], isOrgAdmin: false })).get("/api/v1/mcp/catalog");

      expect(res.body).toEqual([]);
    });

    it("dev-open bypass returns the full published catalogue without consulting grants", async function _devOpen()
    {
      const { prisma, spies } = _mockPrisma({ "mcpServer.findMany": function _findMany() { return Promise.resolve(_servers); } });
      const res = await request(_buildApp(prisma)).get("/api/v1/mcp/catalog");

      expect(res.status).toBe(200);
      expect(res.body.map(function _id(s: { id: string }) { return s.id; }).sort()).toEqual(["srv-closed", "srv-open"]);
      expect(spies["grant.findMany"]).toBeUndefined();
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

    it("transitions to connected when Obot reports the configured server", async function _connect()
    {
      const { prisma, store } = _statefulPrisma("SingleUser");
      // A provisioned install (its Obot instance exists) whose credential configure
      // succeeds in Obot — the only path to `connected`.
      store.install = { id: "inst-1", mcpServerId: "srv-1", userId: "user-1", obotInstanceId: "obot-inst-1", connectionStatus: "NeedsCredential", credentialRef: null, connectedAccount: null, lastUsedAt: null, mcpServer: { serverType: "SingleUser", obotServerId: "obot-srv-1" } };
      const res = await request(_buildApp(prisma, { sub: "user-1" }, _stubObotConfigured()))
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

  describe("PUT /servers/:id/access — authors entitlement into the generic Grant table", function _authoring()
  {
    /** Base overrides so the access-policy write path resolves without touching a real DB. */
    function _authoringPrisma(): { prisma: PrismaClient; spies: Record<string, ReturnType<typeof vi.fn>> }
    {
      return _mockPrisma({
        "mcpServer.findUnique": function _find() { return Promise.resolve({ id: "srv-1" }); },
        "grant.deleteMany": function _del() { return Promise.resolve({ count: 0 }); },
        "grant.createMany": function _create() { return Promise.resolve({ count: 0 }); },
        "mcpServerAccessPolicy.upsert": function _upsert() { return Promise.resolve({ id: "pol-1" }); },
        "mcpServerAccessUser.deleteMany": function _delUsers() { return Promise.resolve({ count: 0 }); },
        "mcpServerAccessUser.createMany": function _createUsers() { return Promise.resolve({ count: 0 }); },
        "auditEntry.create": function _audit() { return Promise.resolve({}); },
      });
    }

    it("writes Allow grants for each group and user, clearing only admin-authored rows", async function _writesGrants()
    {
      process.env.OPENCRANE_API_TOKEN = "ci-token";
      const { prisma, spies } = _authoringPrisma();
      const res = await request(_buildApp(prisma, { sub: "admin", isOrgAdmin: true }))
        .put("/api/v1/mcp/servers/srv-1/access").send({ everyoneInOrg: false, groups: ["g1"], users: ["u1"] });

      expect(res.status).toBe(200);
      // Clears only admin-authored (sharedBy: null) MCP grants so S4 shares survive.
      expect(spies["grant.deleteMany"]).toHaveBeenCalledWith({ where: { mcpServerId: "srv-1", payloadType: "McpServer", sharedBy: null } });
      const rows = spies["grant.createMany"].mock.calls[0][0].data as Array<{ subjectType: string; subjectId: string; access: string; payloadId: string }>;
      expect(rows).toEqual(expect.arrayContaining([
        expect.objectContaining({ subjectType: "Group", subjectId: "g1", access: "Allow", payloadId: "srv-1" }),
        expect.objectContaining({ subjectType: "User", subjectId: "u1", access: "Allow", payloadId: "srv-1" }),
      ]));
    });

    it("writes a single org-everyone sentinel grant when everyoneInOrg is set", async function _writesOrgWide()
    {
      process.env.OPENCRANE_API_TOKEN = "ci-token";
      const { prisma, spies } = _authoringPrisma();
      const res = await request(_buildApp(prisma, { sub: "admin", isOrgAdmin: true }))
        .put("/api/v1/mcp/servers/srv-1/access").send({ everyoneInOrg: true, groups: [], users: [] });

      expect(res.status).toBe(200);
      const rows = spies["grant.createMany"].mock.calls[0][0].data as Array<{ subjectType: string; subjectId: string; access: string }>;
      expect(rows).toEqual([expect.objectContaining({ subjectType: "Group", subjectId: "*", access: "Allow" })]);
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
    /** Install row shape the credential flow now selects (joined with its server's Obot ids). */
    function _provisionedInstall(): Record<string, unknown>
    {
      return { id: "inst-1", mcpServerId: "srv-1", userId: "user-1", obotInstanceId: "obot-inst-1", connectionStatus: "NeedsCredential", credentialRef: null, connectedAccount: null, lastUsedAt: null, mcpServer: { serverType: "SingleUser", obotServerId: "obot-srv-1" } };
    }

    it("streams the submitted values to Obot and never echoes them or the credentialRef", async function _writeOnly()
    {
      const store: { install: Record<string, unknown> | null } = { install: _provisionedInstall() };
      const { prisma } = _mockPrisma({
        "mcpServerInstall.findUnique": function _f() { return Promise.resolve(store.install); },
        "mcpServerInstall.update": function _u(arg: unknown) { store.install = { ...(store.install ?? {}), ...(arg as { data: Record<string, unknown> }).data }; return Promise.resolve(store.install); },
        "auditEntry.create": function _a() { return Promise.resolve({}); },
      });
      const res = await request(_buildApp(prisma, { sub: "user-1" }, _stubObotConfigured()))
        .put("/api/v1/mcp/installed/srv-1/credential").send({ values: { apiKey: "SUPER-SECRET-123", token: "t0ps3cret" } });

      expect(res.status).toBe(200);
      expect(res.body.connectionStatus).toBe("connected");
      const serialised = JSON.stringify(res.body);
      expect(serialised).not.toContain("SUPER-SECRET-123");
      expect(serialised).not.toContain("t0ps3cret");
      expect(serialised).not.toContain("credentialRef");
      expect(serialised).not.toContain("cred_");
      expect(serialised).not.toContain("connect/abc");
      expect(Object.keys(res.body).sort()).toEqual(["connectionStatus", "lastUsed", "serverId"]);
    });

    it("fails closed (never 'connected', no cred_ handle) when the Obot op throws", async function _failClosed()
    {
      const store: { install: Record<string, unknown> | null } = { install: _provisionedInstall() };
      const { prisma } = _mockPrisma({
        "mcpServerInstall.findUnique": function _f() { return Promise.resolve(store.install); },
        "mcpServerInstall.update": function _u(arg: unknown) { store.install = { ...(store.install ?? {}), ...(arg as { data: Record<string, unknown> }).data }; return Promise.resolve(store.install); },
        "auditEntry.create": function _a() { return Promise.resolve({}); },
      });
      // Default router client is the fail-closed no-op, which throws on configureServer.
      const res = await request(_buildApp(prisma, { sub: "user-1" }))
        .put("/api/v1/mcp/installed/srv-1/credential").send({ values: { apiKey: "SUPER-SECRET-123" } });

      expect(res.status).toBe(200);
      expect(res.body.connectionStatus).toBe("activation-failed");
      const serialised = JSON.stringify(res.body);
      expect(serialised).not.toContain("SUPER-SECRET-123");
      expect(serialised).not.toContain("cred_");
    });

    it("fails closed when the server is not provisioned in Obot yet", async function _notProvisioned()
    {
      const install = { ..._provisionedInstall(), obotInstanceId: null };
      const store: { install: Record<string, unknown> | null } = { install };
      const { prisma } = _mockPrisma({
        "mcpServerInstall.findUnique": function _f() { return Promise.resolve(store.install); },
        "mcpServerInstall.update": function _u(arg: unknown) { store.install = { ...(store.install ?? {}), ...(arg as { data: Record<string, unknown> }).data }; return Promise.resolve(store.install); },
        "auditEntry.create": function _a() { return Promise.resolve({}); },
      });
      const res = await request(_buildApp(prisma, { sub: "user-1" }, _stubObotConfigured()))
        .put("/api/v1/mcp/installed/srv-1/credential").send({ values: { apiKey: "x" } });

      expect(res.status).toBe(200);
      expect(res.body.connectionStatus).toBe("activation-failed");
    });
  });
});
