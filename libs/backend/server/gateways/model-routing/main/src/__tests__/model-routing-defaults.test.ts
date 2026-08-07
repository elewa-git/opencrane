import express from "express";
import type { Express } from "express";
import { Prisma, type PrismaClient } from "@prisma/client";
import request from "supertest";
import { describe, expect, it } from "vitest";

// Side-effect import: loads the express-session SessionData.authUser augmentation.
import "@opencrane/backend/_server/auth";
import { _ErrorHandler } from "@opencrane/backend/_server/http";
import type { AuthUser } from "@opencrane/backend/_server/auth";
import { modelRoutingDefaultsRouter } from "../routes/model-routing-defaults.js";

/** In-memory model_routing_defaults store backing the mock Prisma client. */
type Row = Record<string, unknown>;

/** Build a complete OIDC session identity accepted by the ClusterTenant scope guard. */
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

/** Build a Prisma stub over an in-memory map keyed by the unique (scope, clusterTenant) pair. */
function _mockPrisma(store: Map<string, Row>, tenantClusterTenant: string | null = null): PrismaClient
{
  let seq = 0;
  function _key(scope: string, clusterTenant: string | null): string { return `${scope}:${clusterTenant ?? ""}`; }
  return {
    orgMembership: {
      findMany: async function _findMany(args: { where?: { clusterTenant?: string } })
      {
        const requestedClusterTenant = args.where?.clusterTenant;
        return tenantClusterTenant && (!requestedClusterTenant || requestedClusterTenant === tenantClusterTenant)
          ? [{ clusterTenant: tenantClusterTenant }]
          : [];
      },
    },
    modelRoutingDefault: {
      findMany: async function _list(args?: { where?: { clusterTenant?: string } })
      {
        const all = Array.from(store.values());
        const ct = args?.where?.clusterTenant;
        return ct ? all.filter(function _byCt(r) { return r.clusterTenant === ct; }) : all;
      },
      findUnique: async function _findUnique(args: { where: { id: string } })
      {
        return Array.from(store.values()).find(function _byId(r) { return r.id === args.where.id; }) ?? null;
      },
      findFirst: async function _findFirst(args: { where: { scope: string; clusterTenant: string | null } })
      {
        return store.get(_key(args.where.scope, args.where.clusterTenant)) ?? null;
      },
      create: async function _create(args: { data: Row })
      {
        const now = new Date("2026-06-18T00:00:00.000Z");
        const row: Row = { id: `default-${++seq}`, createdAt: now, updatedAt: now, ...args.data };
        store.set(_key(String(row.scope), (row.clusterTenant as string | null) ?? null), row);
        return row;
      },
      update: async function _update(args: { where: { id: string }; data: Row })
      {
        const now = new Date("2026-06-18T00:00:00.000Z");
        for (const [k, v] of store)
        {
          if (v.id === args.where.id)
          {
            const row = { ...v, ...args.data, updatedAt: now };
            store.set(k, row);
            return row;
          }
        }
        return null;
      },
      delete: async function _delete(args: { where: { id: string } })
      {
        for (const [k, v] of store)
        {
          if (v.id === args.where.id) { store.delete(k); }
        }
        return {};
      },
    },
  } as unknown as PrismaClient;
}

/** Build a minimal app mounting the defaults router with a canonical authenticated session. */
function _buildApp(prisma: PrismaClient, user: AuthUser | null = _authUser({ isPlatformOperator: true, isOrgAdmin: true })): Express
{
  const app = express();
  app.use(express.json());
  if (user)
  {
    app.use(function _seedSession(req, _res, next)
    {
      Object.defineProperty(req, "session", { configurable: true, value: { authUser: user } });
      next();
    });
  }
  app.use("/api/v1/model-routing/defaults", modelRoutingDefaultsRouter(prisma));
  app.use(_ErrorHandler({ warn: function _warn() {}, error: function _error() {} } as never));
  return app;
}

/** A valid auto-routing config for write bodies. */
function _autoConfig(): Record<string, unknown>
{
  return { objective: "balanced", sessionPin: true, explorationRate: 0 };
}

describe("modelRoutingDefaultsRouter", function _suite()
{
  it("upserts a Global default and lists it", async function _upsertGlobal()
  {
    const store = new Map<string, Row>();
    const app = _buildApp(_mockPrisma(store));

    const put = await request(app).put("/api/v1/model-routing/defaults").send({ defaultModel: "openai/gpt-4o" });
    expect(put.status).toBe(200);
    expect(put.body.scope).toBe("global");
    expect(put.body.defaultModel).toBe("openai/gpt-4o");

    const list = await request(app).get("/api/v1/model-routing/defaults");
    expect(list.body).toHaveLength(1);
  });

  it("upserts in place on repeated writes for the same (scope, clusterTenant)", async function _upsertInPlace()
  {
    const store = new Map<string, Row>();
    const app = _buildApp(_mockPrisma(store));

    await request(app).put("/api/v1/model-routing/defaults").send({ defaultModel: "a" });
    await request(app).put("/api/v1/model-routing/defaults").send({ defaultModel: "b" });

    const list = await request(app).get("/api/v1/model-routing/defaults");
    expect(list.body).toHaveLength(1);
    expect(list.body[0].defaultModel).toBe("b");
  });

  it("stays idempotent when a concurrent create loses the race (P2002 -> update)", async function _upsertRace()
  {
    const raced: Row = { id: "default-raced", scope: "Global", clusterTenant: null, defaultModel: "openai/gpt-4o", autoConfig: null, createdAt: new Date(), updatedAt: new Date() };
    let firstFind = true;
    const prisma = {
      orgMembership: { findMany: async function _fm() { return []; } },
      modelRoutingDefault: {
        // First lookup (pre-create) sees nothing; the post-P2002 lookup finds the racer's row.
        findFirst: async function _ff() { if (firstFind) { firstFind = false; return null; } return raced; },
        create: async function _create() { throw new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "test" }); },
        update: async function _update(args: { where: { id: string }; data: Row }) { return { ...raced, ...args.data, updatedAt: new Date() }; },
      },
    } as unknown as PrismaClient;

    const res = await request(_buildApp(prisma)).put("/api/v1/model-routing/defaults").send({ defaultModel: "anthropic/claude" });

    expect(res.status).toBe(200);
    expect(res.body.id).toBe("default-raced");
    expect(res.body.defaultModel).toBe("anthropic/claude");
  });

  it("accepts an auto-config-only default", async function _autoOnly()
  {
    const app = _buildApp(_mockPrisma(new Map()));
    const res = await request(app).put("/api/v1/model-routing/defaults").send({ autoConfig: _autoConfig() });

    expect(res.status).toBe(200);
    expect(res.body.autoConfig.objective).toBe("balanced");
  });

  it("rejects a default that names neither a model nor an auto config (400)", async function _emptyRejected()
  {
    const res = await request(_buildApp(_mockPrisma(new Map()))).put("/api/v1/model-routing/defaults").send({});
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
    expect(res.body.issues).toContainEqual({ location: "body", path: ["defaultModel"], message: "Provide a default model or auto-routing configuration." });
  });

  it("rejects clusterTenant scope without a clusterTenant (400)", async function _missingCt()
  {
    const res = await request(_buildApp(_mockPrisma(new Map()))).put("/api/v1/model-routing/defaults").send({ scope: "clusterTenant", defaultModel: "x" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
    expect(res.body.issues).toContainEqual({ location: "body", path: ["clusterTenant"], message: "A cluster tenant is required for this scope." });
  });

  it("rejects a malformed auto config (400)", async function _badAuto()
  {
    const res = await request(_buildApp(_mockPrisma(new Map()))).put("/api/v1/model-routing/defaults").send({ autoConfig: { objective: "nope", sessionPin: true, explorationRate: 0 } });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
    expect(res.body.issues).toContainEqual({ location: "body", path: ["autoConfig", "objective"], message: "This field has an unsupported value." });
  });

	it("preserves extension fields in a validated auto config", async function _PreserveExtensions()
	{
		const response = await request(_buildApp(_mockPrisma(new Map()))).put("/api/v1/model-routing/defaults").send({ autoConfig: { ..._autoConfig(), futureKnob: "kept" } });

		expect(response.status).toBe(200);
		expect(response.body.autoConfig.futureKnob).toBe("kept");
	});

	it("runs the authorization guard before field validation", async function _AuthorizeBeforeValidation()
	{
		const app = _buildApp(_mockPrisma(new Map()), _authUser({ sub: "user-acme" }));
		const response = await request(app).put("/api/v1/model-routing/defaults").send({ defaultModel: 42 });

		expect(response.status).toBe(403);
		expect(response.body).toEqual({ error: "Not authorized for this resource scope.", code: "FORBIDDEN_SCOPE" });
	});

  it("returns 404 for an unknown default", async function _get404()
  {
    const res = await request(_buildApp(_mockPrisma(new Map()))).get("/api/v1/model-routing/defaults/nope");
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("MODEL_ROUTING_DEFAULT_NOT_FOUND");
  });

  it("scope guard: a non-operator may NOT upsert a Global default (403)", async function _guardGlobalDenied()
  {
    const app = _buildApp(_mockPrisma(new Map()), _authUser({ sub: "user-acme" }));
    const res = await request(app).put("/api/v1/model-routing/defaults").send({ defaultModel: "x" });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("FORBIDDEN_SCOPE");
  });

  it("scope guard: a non-operator may upsert a default for their OWN ClusterTenant", async function _guardOwnCt()
  {
    const store = new Map<string, Row>();
    const app = _buildApp(_mockPrisma(store, "acme"), _authUser({ sub: "user-acme" }));
    const res = await request(app).put("/api/v1/model-routing/defaults").send({ scope: "clusterTenant", clusterTenant: "acme", defaultModel: "x" });
    expect(res.status).toBe(200);
    expect(res.body.clusterTenant).toBe("acme");
  });

  it("scope guard: a non-operator may NOT upsert a default for another ClusterTenant (403)", async function _guardOtherCt()
  {
    const app = _buildApp(_mockPrisma(new Map(), "acme"), _authUser({ sub: "user-acme" }));
    const res = await request(app).put("/api/v1/model-routing/defaults").send({ scope: "clusterTenant", clusterTenant: "other", defaultModel: "x" });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("FORBIDDEN_SCOPE");
  });

  it("deletes an existing default", async function _delete()
  {
    const store = new Map<string, Row>();
    const app = _buildApp(_mockPrisma(store));
    const put = await request(app).put("/api/v1/model-routing/defaults").send({ defaultModel: "x" });
    const res = await request(app).delete(`/api/v1/model-routing/defaults/${put.body.id}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("deleted");
    expect(store.size).toBe(0);
  });

  it("scope guard fails closed under real auth: no session -> 403 (AIR.0b)", async function _failClosed()
  {
    const previousOidc = {
      issuerUrl: process.env.OIDC_ISSUER_URL,
      clientId: process.env.OIDC_CLIENT_ID,
      redirectUri: process.env.OIDC_REDIRECT_URI,
      sessionSecret: process.env.OIDC_SESSION_SECRET,
    };
    process.env.OIDC_ISSUER_URL = "https://issuer.example.test";
    process.env.OIDC_CLIENT_ID = "opencrane";
    process.env.OIDC_REDIRECT_URI = "https://opencrane.example.test/auth/callback";
    process.env.OIDC_SESSION_SECRET = "test-session-secret";
    try
    {
      const res = await request(_buildApp(_mockPrisma(new Map()), null))
        .put("/api/v1/model-routing/defaults")
        .send({ defaultModel: "openai/gpt-4o" });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe("FORBIDDEN_SCOPE");
    }
    finally
    {
      if (previousOidc.issuerUrl === undefined) { delete process.env.OIDC_ISSUER_URL; } else { process.env.OIDC_ISSUER_URL = previousOidc.issuerUrl; }
      if (previousOidc.clientId === undefined) { delete process.env.OIDC_CLIENT_ID; } else { process.env.OIDC_CLIENT_ID = previousOidc.clientId; }
      if (previousOidc.redirectUri === undefined) { delete process.env.OIDC_REDIRECT_URI; } else { process.env.OIDC_REDIRECT_URI = previousOidc.redirectUri; }
      if (previousOidc.sessionSecret === undefined) { delete process.env.OIDC_SESSION_SECRET; } else { process.env.OIDC_SESSION_SECRET = previousOidc.sessionSecret; }
    }
  });
});
