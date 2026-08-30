import express from "express";
import type { Express } from "express";
import * as k8s from "@kubernetes/client-node";
import type { Prisma, PrismaClient } from "@prisma/client";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { _BYOK_PROVIDER_CATALOG, ProviderEmbeddingReconciliationStatuses } from "@opencrane/backend/server/gateways/model-routing";

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
  const matchModel = (r: Row, where?: { scope?: string; clusterTenant?: string | null; publicModelName?: string; isDefault?: boolean; providerCredentialId?: string; OR?: readonly unknown[] }): boolean =>
    !where || ((where.scope === undefined || r.scope === where.scope)
      && (where.clusterTenant === undefined || r.clusterTenant === where.clusterTenant)
      && (where.publicModelName === undefined || r.publicModelName === where.publicModelName)
      && (where.isDefault === undefined || r.isDefault === where.isDefault)
	  && (where.providerCredentialId === undefined || r.providerCredentialId === where.providerCredentialId)
	  && (where.OR === undefined || r.publicModelName === "auto" || r.hasAgentRevision === true));
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
		findUnique: async function _findUnique(args: { where: { id?: string; id_siloId?: { id: string } } }) { return store.get(args.where.id_siloId?.id ?? args.where.id!) ?? null; },
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
		  if (match(r, args.where))
		  {
			store.delete(id);
			count++;
		  }
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
			replaceManagedGrants: async function _Replace()
			{
				if (allow)
					return { outcome: "allow", changedCount: 1, evidence: {} };
				return { outcome: "deny", changedCount: 0, evidence: null };
			},
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
		  if (!s)
			throw _notFound();
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
		  if (!secrets.has(args.name))
			throw _notFound();
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
		const existing = Array.from(store.entries()).find(function _Provider([, row]) { return row.provider === payload.provider; });
		const id = existing?.[0] ?? `byok:acme:${payload.provider}`;
		store.set(id, { id, scope: "Global", clusterTenant: null, provider: payload.provider, secretRef: `byok-provider-key-${payload.provider}`, litellmCredentialName: null, createdAt: new Date(), updatedAt: new Date() });
		const catalog = _BYOK_PROVIDER_CATALOG[payload.provider];
		for (const entry of catalog?.models ?? [])
		{
			const modelId = `model-${entry.slug}`;
			models.set(modelId, { id: modelId, scope: "Global", clusterTenant: null, publicModelName: entry.slug, upstreamModel: entry.slug, litellmModelId: `deployment:${entry.slug}`, apiBase: null, isDefault: false, providerCredentialId: id, createdAt: new Date(), updatedAt: new Date() });
		}
		const projections = (catalog?.models ?? []).map(function _Projection(entry) { return { publicModelName: entry.slug, upstreamModel: entry.slug, litellmModelId: `deployment:${entry.slug}` }; });
		return { status: ProviderEffectExecutionStatuses.Succeeded, result: { kind: ProviderEffectCommandKinds.SetByokKey, provider: payload.provider, secretRef: `byok-provider-key-${payload.provider}`, litellmCredentialName: null, models: projections, embedding: { status: catalog?.embeddingModel === undefined ? ProviderEmbeddingReconciliationStatuses.NotApplicable : ProviderEmbeddingReconciliationStatuses.Skipped, deployments: [] } } };
      }
		for (const [id, row] of store)
		{
			if (row.provider === payload.provider)
				store.delete(id);
		}
		return { status: ProviderEffectExecutionStatuses.Succeeded, result: { kind: ProviderEffectCommandKinds.DeleteByokKey, provider: payload.provider } };
    },
  } as ProviderEffectCommandExecutor;
  app.use(express.json());
  app.use("/api/v1/providers/byok", providerByokRouter(prisma, coreApi, _NS, executor, function _Caller() { return { siloId: "acme", principalId: "principal-1" }; }, _Authorization(user.authorized)));
  return app;
}

describe("providerByokRouter", function _suite()
{
  // LiteLLM is unconfigured in tests, so the /credentials push is a no-op and keys stay Secret-only.
  const _saved: Record<string, string | undefined> = {};
	beforeAll(function _clearLitellmEnv()
	{
		for (const k of ["LITELLM_ENDPOINT", "LITELLM_MASTER_KEY"])
		{
			_saved[k] = process.env[k];
			delete process.env[k];
		}
	});
  afterAll(function _restoreLitellmEnv()
  {
		for (const k of ["LITELLM_ENDPOINT", "LITELLM_MASTER_KEY"])
		{
			if (_saved[k] !== undefined)
				process.env[k] = _saved[k];
		}
  });

  it("never echoes the raw key back in the response body", async function _noEcho()
  {
    const res = await request(_buildApp(new Map(), new Map())).put("/api/v1/providers/byok/anthropic").send({ apiKey: "sk-secret-xyz" });

    expect(JSON.stringify(res.body)).not.toContain("sk-secret-xyz");
  });

  it("returns only after the injected executor projects usable provider models", async function _ProjectsModels()
	{
		const models = new Map<string, Row>();
		const response = await request(_buildApp(new Map(), new Map(), { authorized: true }, models)).put("/api/v1/providers/byok/openai").send({ apiKey: "sk-live-123" });

		expect(response.status).toBe(200);
		expect(Array.from(models.values()).find(function _Flagship(model) { return model.publicModelName === "openai/gpt-5.5"; })).toMatchObject({ isDefault: false, providerCredentialId: "byok:acme:openai", litellmModelId: "deployment:openai/gpt-5.5" });
	});

	it("returns 409 before admitting deletion while a frozen model still uses the provider", async function _BlocksProviderWithModels()
	{
		const store = new Map<string, Row>([["cred-1", { id: "cred-1", scope: "Global", clusterTenant: null, provider: "openai", updatedAt: new Date() }]]);
		const models = new Map<string, Row>([["model-1", { id: "model-1", scope: "Global", clusterTenant: null, publicModelName: "openai/gpt-5.5", upstreamModel: "openai/gpt-5.5", litellmModelId: "deployment-1", apiBase: null, providerCredentialId: "cred-1", isDefault: false, agentRevisions: [{ id: "revision-1" }] }]]);
		const commands = new Map<string, Row>();
		const response = await request(_buildApp(store, new Map(), { authorized: true }, models, commands)).delete("/api/v1/providers/byok/openai");

		expect(response.status).toBe(409);
		expect(response.body.code).toBe("PROVIDER_CONNECTION_GOVERNED");
		expect(commands.size).toBe(0);
		expect(store.has("cred-1")).toBe(true);
	});

	it.each(["put", "delete"] as const)("returns 409 for a conflicting %s while a provider command is claimed", async function _ProviderConflict(method)
	{
		const commands = new Map<string, Row>([["command-a", { id: "command-a", siloId: "acme", resourceKind: "provider-connection", resourceId: "byok:acme:openai", desiredGeneration: 1, state: "Claimed", claimExpiresAt: new Date("2026-06-30T12:00:00.000Z") }]]);
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

	it("refuses terminal command status after the provider read grant is revoked", async function _RevokedTerminalRead()
	{
		const commandId = "command-succeeded";
		const store = new Map<string, Row>([["byok:acme:openai", { id: "byok:acme:openai", siloId: "acme", scope: "Global", clusterTenant: null, provider: "openai", secretRef: "byok-provider-key-openai", litellmCredentialName: "byok-openai", createdAt: new Date(), updatedAt: new Date() }]]);
		const commands = new Map<string, Row>([[commandId, { id: commandId, siloId: "acme", kind: ProviderEffectCommandKinds.SetByokKey, payload: { provider: "openai" }, resourceKind: "provider-connection", resourceId: "byok:acme:openai", desiredGeneration: 1, state: "Succeeded" }]]);
		const app = _buildApp(store, new Map(), { authorized: false }, new Map(), commands);

		const response = await request(app).put("/api/v1/providers/byok/openai").send({ apiKey: "sk-retry", commandId });

		expect(response.status).toBe(403);
		expect(response.body.code).toBe("FORBIDDEN");
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

});
