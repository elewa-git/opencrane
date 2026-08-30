import { Buffer } from "node:buffer";

import express from "express";
import type { Express } from "express";
import * as k8s from "@kubernetes/client-node";
import type { Prisma, PrismaClient } from "@prisma/client";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { _DeprovisionByokKey, _ProvisionByokKey } from "@opencrane/backend/server/gateways/model-routing";

import { _log } from "../log";
import { ProviderEffectCommandKinds, ProviderEffectExecutionStatuses, type ProviderEffectCommandExecutor } from "../provider-effect-command.types";
import type { ProviderGatewayAuthorizationFactory } from "../provider-gateway-authority.types";
import { providerByokRouter } from "../routes/provider-byok";

/** In-memory provider_credentials store backing the mock Prisma client. */
type Row = Record<string, unknown>;

/** The operator namespace the router writes Secrets into, in tests. */
const _NS = "opencrane-acme";

/**
 * Builds a Prisma stub for the credential, model, and routing-default calls made while a BYOK key
 * is provisioned.
 */
function _mockPrisma(store: Map<string, Row>, models: Map<string, Row> = new Map(), commands: Map<string, Row> = new Map()): PrismaClient
{
  let seq = 0;
  let modelSeq = 0;
  let routingDefault: Row | null = null;
  const match = (r: Row, where?: { scope?: string; clusterTenant?: string | null; provider?: string }): boolean =>
    !where || ((where.scope === undefined || r.scope === where.scope)
      && (where.clusterTenant === undefined || r.clusterTenant === where.clusterTenant)
      && (where.provider === undefined || r.provider === where.provider));
  const matchModel = (r: Row, where?: { scope?: string; clusterTenant?: string | null; publicModelName?: string; isDefault?: boolean }): boolean =>
    !where || ((where.scope === undefined || r.scope === where.scope)
      && (where.clusterTenant === undefined || r.clusterTenant === where.clusterTenant)
      && (where.publicModelName === undefined || r.publicModelName === where.publicModelName)
      && (where.isDefault === undefined || r.isDefault === where.isDefault));
	const client = {
    modelDefinition: {
      findMany: async function _mFindMany(args: { where: Record<string, unknown>; take?: number })
      {
        const matches = Array.from(models.values()).filter(function _m(r) { return matchModel(r, args.where); });
        return args.take === undefined ? matches : matches.slice(0, args.take);
      },
      findFirst: async function _mFindFirst(args: { where: Record<string, unknown> })
      {
        return Array.from(models.values()).find(function _m(r) { return matchModel(r, args.where); }) ?? null;
      },
      create: async function _mCreate(args: { data: Row })
      {
        const id = `model-${++modelSeq}`;
        const row = { id, isDefault: false, providerCredentialId: null, apiBase: null, ...args.data };
        models.set(id, row);
        return row;
      },
      update: async function _mUpdate(args: { where: { id: string }; data: Row })
      {
        const row = { ...(models.get(args.where.id) as Row), ...args.data };
        models.set(args.where.id, row);
        return row;
      },
    },
    modelRoutingDefault: {
      findFirst: async function _rFindFirst()
      {
        return routingDefault;
      },
      create: async function _rCreate(args: { data: Row })
      {
        routingDefault = { id: "routing-default-1", ...args.data };
        return routingDefault;
      },
    },
    providerCredential: {
      findMany: async function _findMany(args?: { where?: { provider?: { in?: string[] } } })
      {
        const inList = args?.where?.provider?.in;
        return Array.from(store.values()).filter(function _byIn(r) { return !inList || inList.includes(r.provider as string); });
      },
      findFirst: async function _findFirst(args: { where: { scope: string; clusterTenant: string | null; provider: string } })
      {
        return Array.from(store.values()).find(function _m(r) { return match(r, args.where); }) ?? null;
      },
      findUnique: async function _findUnique(args: { where: { id: string } }) { return store.get(args.where.id) ?? null; },
      create: async function _create(args: { data: Row })
      {
        const id = `cred-${++seq}`;
        const now = new Date("2026-06-30T00:00:00.000Z");
        const row = { id, createdAt: now, updatedAt: now, ...args.data };
        store.set(id, row);
        return row;
      },
      update: async function _update(args: { where: { id: string }; data: Row })
      {
        const row = { ...(store.get(args.where.id) as Row), ...args.data, updatedAt: new Date("2026-06-30T12:00:00.000Z") };
        store.set(args.where.id, row);
        return row;
      },
      deleteMany: async function _deleteMany(args: { where: { provider: string } })
      {
        let count = 0;
        for (const [id, r] of store)
        {
          if (match(r, args.where)) { store.delete(id); count++; }
        }
        return { count };
      },
    },
    providerEffectCommand: {
	  findFirst: async function _findCurrentCommand(args: { where: { siloId: string; resourceKind: string; resourceId: string; state?: string | { in: string[] }; OR?: unknown } })
	  {
		return Array.from(commands.values())
			.filter(function _Same(row)
			{
				if (row.siloId !== args.where.siloId || row.resourceKind !== args.where.resourceKind || row.resourceId !== args.where.resourceId)
					return false;
				if (args.where.OR !== undefined)
					return row.state === "Claimed" || (["Pending", "AwaitingMaterial"].includes(row.state as string) && row.failureCode === "provider_effect_outcome_uncertain");
				if (typeof args.where.state === "string")
					return row.state === args.where.state;
				return args.where.state === undefined || args.where.state.in.includes(row.state as string);
			})
			.sort(function _Newest(left, right) { return Number(right.desiredGeneration ?? 0) - Number(left.desiredGeneration ?? 0); })[0] ?? null;
	  },
      create: async function _createCommand(args: { data: Row })
      {
        const now = new Date("2026-06-30T00:00:00.000Z");
        const row: Row = { state: "Pending", deliveryCount: 0, claimFence: null, claimExpiresAt: null, failureCode: null, result: null, completedAt: null, createdAt: now, updatedAt: now, ...args.data };
        commands.set(row.id as string, row);
        return row;
      },
	  updateMany: async function _supersedeCommands() { return { count: 0 }; },
    },
  } as unknown as PrismaClient;
	Object.assign(client, { $transaction: async function _Transaction(operation: (transaction: PrismaClient) => Promise<unknown>) { return operation(client); } });
	return client;
}

/** Build a central authority stub with an explicit allow or deny decision. */
function _Authorization(allow: boolean): ProviderGatewayAuthorizationFactory<Prisma.TransactionClient>
{
	return (function _CreateAuthorization()
	{
		return {
			admitPrincipal: async function _Admit()
			{
				if (!allow)
					return { outcome: "deny", evidence: null };
				return { outcome: "allow", evidence: { decisionDigest: "sha256:decision", policyRevisionHash: "sha256:policy", effectiveAuthorizationDigest: "sha256:effective" } };
			},
			listPrincipalEntitled: async function _List(command: { resources: readonly unknown[] }) { return allow ? command.resources : []; },
		};
	}) as unknown as ProviderGatewayAuthorizationFactory<Prisma.TransactionClient>;
}

/** A k8s 404 error shaped like the client's NotFound, used to drive the create path. */
function _notFound(): Error & { code: number }
{
  return Object.assign(new Error("not found"), { code: 404 });
}

/** Build a CoreV1Api stub backed by an in-memory Secret store keyed by name. */
function _mockCoreApi(secrets: Map<string, k8s.V1Secret>): k8s.CoreV1Api
{
  return {
    readNamespacedSecret: async function _read(args: { name: string })
    {
      const s = secrets.get(args.name);
      if (!s) { throw _notFound(); }
      return s;
    },
    createNamespacedSecret: async function _create(args: { body: k8s.V1Secret })
    {
      secrets.set(args.body.metadata!.name!, args.body);
      return args.body;
    },
    replaceNamespacedSecret: async function _replace(args: { name: string; body: k8s.V1Secret })
    {
      secrets.set(args.name, args.body);
      return args.body;
    },
    deleteNamespacedSecret: async function _delete(args: { name: string })
    {
      if (!secrets.has(args.name)) { throw _notFound(); }
      secrets.delete(args.name);
      return {};
    },
  } as unknown as k8s.CoreV1Api;
}

/**
 * Mount only the BYOK router over the supplied stores, granting the default caller's explicit
 * Organization/Administer admission. Pass `{ authorized: false }` to exercise a denied decision.
 */
function _buildApp(store: Map<string, Row>, secrets: Map<string, k8s.V1Secret>, user: { authorized: boolean } = { authorized: true }, models: Map<string, Row> = new Map(), commands: Map<string, Row> = new Map()): Express
{
  const app = express();
  const prisma = _mockPrisma(store, models, commands);
  const coreApi = _mockCoreApi(secrets);
  const executor = {
	reconcileNext: async function _ReconcileNext() { return false; },
    execute: async function _Execute(commandId: string, material = {})
    {
      const command = commands.get(commandId)!;
      const payload = command.payload as { provider: string };
      if (command.kind === ProviderEffectCommandKinds.SetByokKey)
      {
        const providerKey = (material as { providerKey?: string }).providerKey ?? "";
        const provisioned = await _ProvisionByokKey({ prisma, coreApi, operatorNamespace: _NS, provider: payload.provider, apiKey: providerKey, log: _log });
        return { status: ProviderEffectExecutionStatuses.Succeeded, result: { kind: ProviderEffectCommandKinds.SetByokKey, providerCredentialId: provisioned.row.id, litellmRegistered: provisioned.litellmRegistered } };
      }
      await _DeprovisionByokKey({ prisma, coreApi, operatorNamespace: _NS, provider: payload.provider });
      return { status: ProviderEffectExecutionStatuses.Succeeded, result: { kind: ProviderEffectCommandKinds.DeleteByokKey } };
    },
  } as ProviderEffectCommandExecutor;
  app.use(express.json());
  app.use("/api/v1/providers/byok", providerByokRouter(prisma, coreApi, _NS, function _Caller() { return { siloId: "acme", principalId: "principal-1" }; }, _Authorization(user.authorized), executor));
  return app;
}

describe("providerByokRouter", function _suite()
{
  // LiteLLM is unconfigured in tests, so the /credentials push is a no-op and keys stay Secret-only.
  const _saved: Record<string, string | undefined> = {};
  beforeAll(function _clearLitellmEnv()
  {
    for (const k of ["LITELLM_ENDPOINT", "LITELLM_MASTER_KEY"]) { _saved[k] = process.env[k]; delete process.env[k]; }
  });
  afterAll(function _restoreLitellmEnv()
  {
    for (const k of ["LITELLM_ENDPOINT", "LITELLM_MASTER_KEY"]) { if (_saved[k] !== undefined) { process.env[k] = _saved[k]; } }
  });

  it("sets a provider key: writes the Secret (base64), records the credential, Secret-only without LiteLLM", async function _set()
  {
    const store = new Map<string, Row>();
    const secrets = new Map<string, k8s.V1Secret>();
    const res = await request(_buildApp(store, secrets)).put("/api/v1/providers/byok/openai").send({ apiKey: "sk-live-123" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ provider: "openai", configured: true, litellmRegistered: false });

    const secret = secrets.get("byok-provider-key-openai");
    expect(secret?.metadata?.namespace).toBe(_NS);
    expect(Buffer.from(secret!.data!.apiKey, "base64").toString("utf8")).toBe("sk-live-123");

    const row = Array.from(store.values())[0];
    expect(row).toMatchObject({ scope: "Global", clusterTenant: null, provider: "openai", secretRef: "byok-provider-key-openai", litellmCredentialName: null });
  });

  it("seeds a default model bound to the credential so the agent can route through LiteLLM", async function _seedsDefault()
  {
    const store = new Map<string, Row>();
    const models = new Map<string, Row>();
    const app = _buildApp(store, new Map(), { authorized: true }, models);
    await request(app).put("/api/v1/providers/byok/openai").send({ apiKey: "sk-live-123" });

    // All of OpenAI's model classes are seeded PLUS the stable "auto" model; flagship is default.
    const seeded = Array.from(models.values());
    expect(seeded).toHaveLength(4);
    const flagship = seeded.find(function f(m) { return m.publicModelName === "openai/gpt-5.5"; });
    expect(flagship).toMatchObject({ scope: "Global", clusterTenant: null, isDefault: true });
    // "auto" is backed by the cheapest (fast) model and is a selectable option, not the default.
    expect(seeded.find(function a(m) { return m.publicModelName === "auto"; })).toMatchObject({ upstreamModel: "openai/gpt-5.4-nano", isDefault: false });
    expect(seeded.filter(function d(m) { return m.isDefault; })).toHaveLength(1);
    // Every class is bound to the one upserted credential row.
    const cred = Array.from(store.values())[0];
    expect(seeded.every(function bound(m) { return m.providerCredentialId === cred.id; })).toBe(true);
  });

  it("first provider configured wins the silo default; later providers add models but not the default", async function _firstWins()
  {
    const store = new Map<string, Row>();
    const models = new Map<string, Row>();
    const app = _buildApp(store, new Map(), { authorized: true }, models);
    await request(app).put("/api/v1/providers/byok/openai").send({ apiKey: "k1" });
    await request(app).put("/api/v1/providers/byok/anthropic").send({ apiKey: "k2" });

    // Both providers' full catalogs are registered (3 + 3) plus a single shared "auto" (first
    // provider wins), but only OpenAI's flagship is default.
    const byName = new Map(Array.from(models.values()).map(function _n(m) { return [m.publicModelName, m]; }));
    expect(byName.get("openai/gpt-5.5")).toMatchObject({ isDefault: true });
    expect(byName.get("anthropic/claude-opus-4-8")).toMatchObject({ isDefault: false });
    // "auto" is registered once (by the first provider, OpenAI) and backed by its cheapest model.
    expect(byName.get("auto")).toMatchObject({ upstreamModel: "openai/gpt-5.4-nano", isDefault: false });
    expect(Array.from(models.values()).filter(function d(m) { return m.isDefault; })).toHaveLength(1);
    expect(models.size).toBe(7);
  });

  it("never echoes the raw key back in the response body", async function _noEcho()
  {
    const res = await request(_buildApp(new Map(), new Map())).put("/api/v1/providers/byok/anthropic").send({ apiKey: "sk-secret-xyz" });

    expect(JSON.stringify(res.body)).not.toContain("sk-secret-xyz");
  });

  it("refreshes an existing key in place (update, not duplicate row)", async function _refresh()
  {
    const store = new Map<string, Row>();
    const secrets = new Map<string, k8s.V1Secret>();
    const app = _buildApp(store, secrets);
    await request(app).put("/api/v1/providers/byok/gemini").send({ apiKey: "key-1" });
    const res = await request(app).put("/api/v1/providers/byok/gemini").send({ apiKey: "key-2" });

    expect(res.status).toBe(200);
    expect(Array.from(store.values()).filter(function _g(r) { return r.provider === "gemini"; })).toHaveLength(1);
    expect(Buffer.from(secrets.get("byok-provider-key-gemini")!.data!.apiKey, "base64").toString("utf8")).toBe("key-2");
  });

	it.each(["put", "delete"] as const)("returns 409 for a conflicting %s while a provider command is claimed", async function _ProviderConflict(method)
	{
		const commands = new Map<string, Row>([["command-a", { id: "command-a", siloId: "acme", resourceKind: "provider-connection", resourceId: "byok:openai", desiredGeneration: 1, state: "Claimed", claimExpiresAt: new Date("2026-06-30T12:00:00.000Z") }]]);
		const secrets = new Map<string, k8s.V1Secret>();
		const app = _buildApp(new Map(), secrets, { authorized: true }, new Map(), commands);
		const response = method === "put"
			? await request(app).put("/api/v1/providers/byok/openai").send({ apiKey: "sk-new" })
			: await request(app).delete("/api/v1/providers/byok/openai");

		expect(response.status).toBe(409);
		expect(response.body).toEqual({ error: "Another provider effect still owns this resource.", code: "PROVIDER_EFFECT_BUSY", commandId: "command-a" });
		expect(commands.size).toBe(1);
		expect(secrets.size).toBe(0);
	});

  it("denies a caller without Organization/Administer with 403", async function _denyNonAdmin()
  {
    const store = new Map<string, Row>();
    const secrets = new Map<string, k8s.V1Secret>();
    const app = _buildApp(store, secrets, { authorized: false });
    const res = await request(app).put("/api/v1/providers/byok/openai").send({ apiKey: "sk-live-123" });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("FORBIDDEN");
    expect(secrets.size).toBe(0);
    expect(store.size).toBe(0);
  });

  it("rejects an unsupported provider with 400", async function _badProvider()
  {
    const res = await request(_buildApp(new Map(), new Map())).put("/api/v1/providers/byok/cohere").send({ apiKey: "x" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("UNSUPPORTED_PROVIDER");
  });

  it("rejects a missing apiKey with 400", async function _missingKey()
  {
    const res = await request(_buildApp(new Map(), new Map())).put("/api/v1/providers/byok/openai").send({});

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });

  it("lists status across all supported providers, never the key", async function _list()
  {
    const store = new Map<string, Row>([
      ["cred-1", { id: "cred-1", scope: "Global", clusterTenant: null, provider: "openai", secretRef: "byok-provider-key-openai", litellmCredentialName: "byok-openai", updatedAt: new Date("2026-06-30T00:00:00.000Z") }],
    ]);
    const res = await request(_buildApp(store, new Map())).get("/api/v1/providers/byok");

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(6);
    const openai = res.body.find(function _o(s: { provider: string }) { return s.provider === "openai"; });
    expect(openai).toMatchObject({ configured: true, litellmRegistered: true });
    const mistral = res.body.find(function _m(s: { provider: string }) { return s.provider === "mistral"; });
    expect(mistral).toMatchObject({ configured: false, litellmRegistered: false, updatedAt: null });
    expect(JSON.stringify(res.body)).not.toContain("apiKey");
  });

  it("removes a key: clears the fixed Secret and record, idempotent 204", async function _delete()
  {
    const store = new Map<string, Row>([
      ["cred-1", { id: "cred-1", scope: "Global", clusterTenant: null, provider: "deepseek", secretRef: "byok-provider-key-deepseek", litellmCredentialName: null, updatedAt: new Date() }],
    ]);
    const secrets = new Map<string, k8s.V1Secret>([["byok-provider-key-deepseek", { metadata: { name: "byok-provider-key-deepseek", namespace: _NS } }]]);
    const app = _buildApp(store, secrets);

    const res = await request(app).delete("/api/v1/providers/byok/deepseek");
    expect(res.status).toBe(204);
    expect(secrets.has("byok-provider-key-deepseek")).toBe(true);
    expect(Buffer.from(secrets.get("byok-provider-key-deepseek")!.data!.apiKey, "base64").toString("utf8")).toBe("");
    expect(Array.from(store.values())).toHaveLength(0);

    // Idempotent: deleting again still returns 204.
    const again = await request(app).delete("/api/v1/providers/byok/deepseek");
    expect(again.status).toBe(204);
  });
});
