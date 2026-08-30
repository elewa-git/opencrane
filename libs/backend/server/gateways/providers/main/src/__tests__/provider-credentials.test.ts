import express from "express";
import type { Express } from "express";
import type { Prisma, PrismaClient } from "@prisma/client";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

// Side-effect import: loads the express-session SessionData.authUser augmentation.
import "@opencrane/backend/server/infra/auth";
import type { AuthUser } from "@opencrane/backend/server/infra/auth";
import type { ProviderGatewayAuthorizationFactory } from "../provider-gateway-authority.types";
import { providerCredentialsRouter } from "../routes/provider-credentials";

/** In-memory provider_credentials store backing the mock Prisma client. */
type Row = Record<string, unknown>;

/** Build a complete OIDC platform-operator session for mutation route tests. */
function _platformOperator(): AuthUser
{
  return {
    sub: "operator-1",
    issuer: "https://idp.example.test",
    groups: ["platform-operators"],
		authorizationExpiresAt: "2099-06-18T00:00:00.000Z",
    isPlatformOperator: true,
    email: "operator@example.test",
    authenticatedAt: "2026-06-18T00:00:00.000Z",
  };
}

/** Build a Prisma stub over an in-memory map keyed by credential id. */
function _mockPrisma(store: Map<string, Row>): PrismaClient
{
  let seq = 0;
	function _id(where: { id?: string; id_siloId?: { id: string; siloId: string } }): string
	{
		return where.id_siloId?.id ?? where.id!;
	}
	const client = {
    providerCredential: {
      findMany: async function _findMany(args?: { where?: { clusterTenant?: string } })
      {
        const all = Array.from(store.values());
        const ct = args?.where?.clusterTenant;
        return ct ? all.filter(function _byCt(r) { return r.clusterTenant === ct; }) : all;
      },
		findUnique: async function _findUnique(args: { where: { id?: string; id_siloId?: { id: string; siloId: string } } })
		{
			const row = store.get(_id(args.where)) ?? null;
			return row !== null && (args.where.id_siloId === undefined || (row.siloId ?? "acme") === args.where.id_siloId.siloId) ? row : null;
		},
      create: async function _create(args: { data: Row })
      {
        const id = `cred-${++seq}`;
        const now = new Date("2026-06-18T00:00:00.000Z");
		const row = { id, siloId: "acme", litellmCredentialName: null, clusterTenant: null, createdAt: now, updatedAt: now, ...args.data };
        store.set(id, row);
        return row;
      },
		update: async function _update(args: { where: { id?: string; id_siloId?: { id: string; siloId: string } }; data: Row })
      {
		const id = _id(args.where);
		const row = { ...(store.get(id) as Row), ...args.data, updatedAt: new Date() };
		store.set(id, row);
        return row;
      },
		delete: async function _delete(args: { where: { id?: string; id_siloId?: { id: string; siloId: string } } }) { store.delete(_id(args.where)); return {}; },
    },
  } as unknown as PrismaClient;
	Object.assign(client, { $transaction: async function _Transaction(operation: (transaction: PrismaClient) => Promise<unknown>) { return operation(client); } });
	return client;
}

/** Central authority stub that admits mutations and returns every catalogue candidate. */
const _ALLOW_AUTHORIZATION = (function _CreateAuthorization()
{
	return {
		admitPrincipal: async function _Admit() { return { outcome: "allow" }; },
		listPrincipalEntitled: async function _List(command: { resources: readonly unknown[] }) { return command.resources; },
		replaceManagedGrants: async function _Replace() { return { outcome: "allow", changedCount: 1, evidence: {} }; },
	};
}) as unknown as ProviderGatewayAuthorizationFactory<Prisma.TransactionClient>;

/** Build a minimal app mounting the credential router with an authenticated operator session. */
function _buildApp(prisma: PrismaClient, user: AuthUser | null = _platformOperator(), authorization: ProviderGatewayAuthorizationFactory<Prisma.TransactionClient> = _ALLOW_AUTHORIZATION): Express
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
  const resolveCaller = user === null ? function _NoCaller() { return null; } : function _Caller() { return { siloId: "acme", principalId: "principal-1" }; };
  app.use("/api/v1/providers/credentials", providerCredentialsRouter(prisma, resolveCaller, authorization));
  return app;
}

describe("providerCredentialsRouter", function _suite()
{
	it("filters exact ProviderConnection reads and admits mutation as organisation policy", async function _CentralAuthority()
	{
		const store = new Map<string, Row>([
			["cred-1", { id: "cred-1", scope: "Global", clusterTenant: null, provider: "openai", secretRef: "openai-key", litellmCredentialName: null, createdAt: new Date(), updatedAt: new Date() }],
			["cred-2", { id: "cred-2", scope: "Global", clusterTenant: null, provider: "anthropic", secretRef: "anthropic-key", litellmCredentialName: null, createdAt: new Date(), updatedAt: new Date() }],
		]);
		const listPrincipalEntitled = vi.fn(async function _List(command: { resources: readonly { id: string }[] }) { return command.resources.filter(resource => resource.id === "cred-1"); });
		const admitPrincipal = vi.fn(async function _Admit() { return { outcome: "allow" }; });
		const replaceManagedGrants = vi.fn(async function _Replace() { return { outcome: "allow" }; });
		const factory = (function _CreateAuthorization() { return { listPrincipalEntitled, admitPrincipal, replaceManagedGrants }; }) as unknown as ProviderGatewayAuthorizationFactory<Prisma.TransactionClient>;
		const app = _buildApp(_mockPrisma(store), _platformOperator(), factory);

		const list = await request(app).get("/api/v1/providers/credentials");
		const create = await request(app).post("/api/v1/providers/credentials").send({ provider: "gemini", secretRef: "gemini-key" });

		expect(list.body.map((row: { id: string }) => row.id)).toEqual(["cred-1"]);
		expect(listPrincipalEntitled).toHaveBeenCalledWith(expect.objectContaining({ siloId: "acme", principalId: "principal-1", action: "read", resources: [{ kind: "provider-connection", id: "cred-1" }, { kind: "provider-connection", id: "cred-2" }] }));
		expect(create.status).toBe(201);
		expect(admitPrincipal).toHaveBeenCalledWith(expect.objectContaining({ siloId: "acme", principalId: "principal-1", action: "administer", resource: { kind: "organization", id: "acme" }, actorKind: "user", actorId: "principal-1" }));
		expect(replaceManagedGrants).toHaveBeenCalledWith(expect.objectContaining({
			resource: { kind: "provider-connection", id: expect.any(String) },
			grants: expect.arrayContaining([expect.objectContaining({ capability: expect.objectContaining({ capabilityId: "provider-connection:use" }) })]),
		}));
	});

  it("lists credentials", async function _list()
  {
    const store = new Map<string, Row>([
      ["cred-1", { id: "cred-1", scope: "Global", clusterTenant: null, provider: "openai", secretRef: "openai-key", litellmCredentialName: null, createdAt: new Date(), updatedAt: new Date() }],
    ]);
    const res = await request(_buildApp(_mockPrisma(store))).get("/api/v1/providers/credentials");

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].provider).toBe("openai");
    expect(res.body[0].scope).toBe("global");
  });

  it("creates a global credential (happy path)", async function _create()
  {
    const res = await request(_buildApp(_mockPrisma(new Map()))).post("/api/v1/providers/credentials").send({ provider: "anthropic", secretRef: "anthropic-key" });

    expect(res.status).toBe(201);
    expect(res.body.provider).toBe("anthropic");
    expect(res.body.secretRef).toBe("anthropic-key");
    expect(res.body.scope).toBe("global");
    expect(res.body.clusterTenant).toBeNull();
  });

  it("creates a clusterTenant-scoped credential", async function _createScoped()
  {
    const res = await request(_buildApp(_mockPrisma(new Map()))).post("/api/v1/providers/credentials").send({ scope: "clusterTenant", clusterTenant: "acme", provider: "openai", secretRef: "acme-openai-key" });

    expect(res.status).toBe(201);
    expect(res.body.scope).toBe("clusterTenant");
    expect(res.body.clusterTenant).toBe("acme");
  });

  it("rejects a missing required field with 400", async function _missingRequired()
  {
    const res = await request(_buildApp(_mockPrisma(new Map()))).post("/api/v1/providers/credentials").send({ provider: "openai" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });

  it("rejects clusterTenant scope without a clusterTenant with 400", async function _missingClusterTenant()
  {
    const res = await request(_buildApp(_mockPrisma(new Map()))).post("/api/v1/providers/credentials").send({ scope: "clusterTenant", provider: "openai", secretRef: "k" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });

  it("rejects a raw-key field with 400 (apiKey)", async function _rejectRawApiKey()
  {
    const res = await request(_buildApp(_mockPrisma(new Map()))).post("/api/v1/providers/credentials").send({ provider: "openai", secretRef: "k", apiKey: "sk-secret" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("RAW_KEY_REJECTED");
  });

  it("rejects a raw-key field with 400 (keyValue and key)", async function _rejectOtherRawKeys()
  {
    const app = _buildApp(_mockPrisma(new Map()));
    const a = await request(app).post("/api/v1/providers/credentials").send({ provider: "openai", secretRef: "k", keyValue: "sk-x" });
    const b = await request(app).post("/api/v1/providers/credentials").send({ provider: "openai", secretRef: "k", key: "sk-y" });

    expect(a.status).toBe(400);
    expect(a.body.code).toBe("RAW_KEY_REJECTED");
    expect(b.status).toBe(400);
    expect(b.body.code).toBe("RAW_KEY_REJECTED");
  });

  it("returns 404 for an unknown credential", async function _get404()
  {
    const res = await request(_buildApp(_mockPrisma(new Map()))).get("/api/v1/providers/credentials/nope");

    expect(res.status).toBe(404);
    expect(res.body.code).toBe("PROVIDER_CREDENTIAL_NOT_FOUND");
  });

  it("deletes an existing credential", async function _delete()
  {
    const store = new Map<string, Row>([
      ["cred-1", { id: "cred-1", scope: "Global", clusterTenant: null, provider: "openai", secretRef: "k", litellmCredentialName: null, createdAt: new Date(), updatedAt: new Date() }],
    ]);
    const res = await request(_buildApp(_mockPrisma(store))).delete("/api/v1/providers/credentials/cred-1");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: "cred-1", status: "deleted" });
    expect(store.has("cred-1")).toBe(false);
  });

  it("returns 404 when deleting an unknown credential", async function _delete404()
  {
    const res = await request(_buildApp(_mockPrisma(new Map()))).delete("/api/v1/providers/credentials/nope");

    expect(res.status).toBe(404);
    expect(res.body.code).toBe("PROVIDER_CREDENTIAL_NOT_FOUND");
  });
});
