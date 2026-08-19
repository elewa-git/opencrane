import { Buffer } from "node:buffer";

import * as k8s from "@kubernetes/client-node";
import type { Logger } from "pino";
import type { Prisma, PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { _DeprovisionByokKey, _ProvisionByokKey, _byokSecretName } from "../core/provision-byok-key";
import { PrismaDefaultModelDefinitionResolverRepository } from "../core/prisma-default-model-definition-resolver";
import { DefaultModelDefinitionResolutionStatuses } from "../core/default-model-definition-resolver.types";

/**
 * The shared provisioning core behind both the BYOK route and the boot-time bootstrap. These pin
 * its contract directly (the bootstrap calls it without the HTTP layer): a set writes the Secret,
 * records the Global credential, and seeds a default model; deprovision clears the fixed Secret so
 * restricted RBAC can safely accept a subsequent set.
 */

type Row = Record<string, unknown>;

const _NS = "opencrane-acme";
const _log = { info() { /* noop */ }, warn() { /* noop */ } } as unknown as Logger;

function _mockPrisma(creds: Map<string, Row>, models: Map<string, Row>, routingDefaults: Map<string, Row> = new Map()): PrismaClient
{
  let credSeq = 0;
  let modelSeq = 0;
  return {
    providerCredential: {
      findFirst: async function _f(args: { where: { provider?: string } }) { return Array.from(creds.values()).find(function _m(r) { return r.provider === args.where.provider; }) ?? null; },
      create: async function _c(args: { data: Row }) { const id = `cred-${++credSeq}`; const row = { id, updatedAt: new Date("2026-06-30T00:00:00.000Z"), ...args.data }; creds.set(id, row); return row; },
      update: async function _u(args: { where: { id: string }; data: Row }) { const row = { ...(creds.get(args.where.id) as Row), ...args.data }; creds.set(args.where.id, row); return row; },
      deleteMany: async function _d(args: { where: { provider: string } }) { let count = 0; for (const [id, r] of creds) { if (r.provider === args.where.provider) { creds.delete(id); count++; } } return { count }; },
    },
    modelDefinition: {
      findFirst: async function _mf(args: { where: Record<string, unknown> }) { return Array.from(models.values()).find(function _m(r) { return (args.where.publicModelName === undefined || r.publicModelName === args.where.publicModelName) && (args.where.isDefault === undefined || r.isDefault === args.where.isDefault); }) ?? null; },
      findMany: async function _mm(args: { where: Record<string, unknown>; take?: number }) { return Array.from(models.values()).filter(function _m(r) { return (args.where.publicModelName === undefined || r.publicModelName === args.where.publicModelName) && (args.where.isDefault === undefined || r.isDefault === args.where.isDefault); }).slice(0, args.take); },
      create: async function _mc(args: { data: Row }) { const id = `model-${++modelSeq}`; const row = { id, isDefault: false, providerCredentialId: null, ...args.data }; models.set(id, row); return row; },
      update: async function _mu(args: { where: { id: string }; data: Row }) { const row = { ...(models.get(args.where.id) as Row), ...args.data }; models.set(args.where.id, row); return row; },
    },
    modelRoutingDefault: {
      findFirst: async function _rf() { return Array.from(routingDefaults.values())[0] ?? null; },
      findMany: async function _rm() { return Array.from(routingDefaults.values()); },
      create: async function _rc(args: { data: Row }) { const row = { id: "routing-global", ...args.data }; routingDefaults.set("routing-global", row); return row; },
    },
  } as unknown as PrismaClient;
}

function _mockCoreApi(secrets: Map<string, k8s.V1Secret>): k8s.CoreV1Api
{
  const notFound = () => Object.assign(new Error("not found"), { code: 404 });
  return {
    readNamespacedSecret: async function _r(a: { name: string }) { const s = secrets.get(a.name); if (!s) { throw notFound(); } return s; },
    createNamespacedSecret: async function _c(a: { body: k8s.V1Secret }) { secrets.set(a.body.metadata!.name!, a.body); return a.body; },
    replaceNamespacedSecret: async function _rp(a: { name: string; body: k8s.V1Secret }) { secrets.set(a.name, a.body); return a.body; },
    deleteNamespacedSecret: async function _d(a: { name: string }) { if (!secrets.has(a.name)) { throw notFound(); } secrets.delete(a.name); return {}; },
  } as unknown as k8s.CoreV1Api;
}

describe("_ProvisionByokKey / _DeprovisionByokKey", function _suite()
{
  const _saved: Record<string, string | undefined> = {};
  beforeAll(function _clearEnv() { for (const k of ["LITELLM_ENDPOINT", "LITELLM_MASTER_KEY"]) { _saved[k] = process.env[k]; delete process.env[k]; } });
  afterAll(function _restoreEnv() { for (const k of ["LITELLM_ENDPOINT", "LITELLM_MASTER_KEY"]) { if (_saved[k] !== undefined) { process.env[k] = _saved[k]; } } });

  it("provisions: writes the Secret, records the credential, seeds a default model", async function _provision()
  {
    const creds = new Map<string, Row>();
    const models = new Map<string, Row>();
    const routingDefaults = new Map<string, Row>();
    const secrets = new Map<string, k8s.V1Secret>();

    const prisma = _mockPrisma(creds, models, routingDefaults);
    const result = await _ProvisionByokKey({ prisma, coreApi: _mockCoreApi(secrets), operatorNamespace: _NS, provider: "openai", apiKey: "sk-test-123", log: _log });

    // LiteLLM unconfigured in the test → Secret-only.
    expect(result.litellmRegistered).toBe(false);
    expect(Buffer.from(secrets.get(_byokSecretName("openai"))!.data!.apiKey, "base64").toString("utf8")).toBe("sk-test-123");
    expect(Array.from(creds.values())[0]).toMatchObject({ scope: "Global", clusterTenant: null, provider: "openai" });
    // All of the provider's model classes are seeded PLUS the stable "auto" model, ALL bound to the one credential.
    const seeded = Array.from(models.values());
    expect(seeded).toHaveLength(4);
    expect(seeded.map(function slug(m) { return m.publicModelName; }).sort()).toEqual(["auto", "openai/gpt-5.4", "openai/gpt-5.4-nano", "openai/gpt-5.5"]);
    expect(seeded.every(function bound(m) { return m.providerCredentialId === result.row.id; })).toBe(true);
    // "auto" is backed by the cheapest (fast) class model and is NOT the default (it's a selectable option).
    const auto = seeded.find(function a(m) { return m.publicModelName === "auto"; });
    expect(auto).toMatchObject({ upstreamModel: "openai/gpt-5.4-nano", isDefault: false });
    // The flagship (default class) claims the silo default; the other tiers + auto do not.
    const flagship = seeded.find(function f(m) { return m.publicModelName === "openai/gpt-5.5"; });
    expect(flagship).toMatchObject({ isDefault: true });
    expect(seeded.filter(function d(m) { return m.isDefault; })).toHaveLength(1);
    expect(Array.from(routingDefaults.values())).toEqual([expect.objectContaining({ scope: "Global", clusterTenant: null, defaultModel: "openai/gpt-5.5" })]);
    await expect(new PrismaDefaultModelDefinitionResolverRepository(prisma as unknown as Prisma.TransactionClient).resolve("silo-a")).resolves.toEqual({ status: DefaultModelDefinitionResolutionStatuses.Resolved, modelDefinitionId: flagship?.id });
  });

  it("preserves an operator-configured Global routing default", async function _PreservesRoutingDefault()
  {
    const routingDefaults = new Map<string, Row>([["routing-global", { id: "routing-global", scope: "Global", clusterTenant: null, defaultModel: "operator/model" }]]);

    await _ProvisionByokKey({ prisma: _mockPrisma(new Map(), new Map(), routingDefaults), coreApi: _mockCoreApi(new Map()), operatorNamespace: _NS, provider: "openai", apiKey: "sk-test-123", log: _log });

    expect(Array.from(routingDefaults.values())).toEqual([{ id: "routing-global", scope: "Global", clusterTenant: null, defaultModel: "operator/model" }]);
  });

  it("rejects an ambiguous legacy catalogue default before publishing routing authority", async function _RejectsAmbiguousCatalogueDefault()
  {
    const models = new Map<string, Row>([
      ["legacy-a", { id: "legacy-a", scope: "Global", clusterTenant: null, publicModelName: "legacy/a", isDefault: true }],
      ["legacy-b", { id: "legacy-b", scope: "Global", clusterTenant: null, publicModelName: "legacy/b", isDefault: true }],
    ]);
    process.env.LITELLM_ENDPOINT = "http://litellm:4000";
    process.env.LITELLM_MASTER_KEY = "sk-master";
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async function _fetch(url: string)
    {
      if (url.endsWith("/credentials")) return new Response("{}", { status: 200 });
      if (url.endsWith("/model/new")) return new Response(JSON.stringify({ model_id: `live-${Math.random()}` }), { status: 200 });
      if (url.endsWith("/model/info")) return new Response(JSON.stringify({ data: [] }), { status: 200 });
      return new Response("not found", { status: 404 });
    }));
    try
    {
      await expect(_ProvisionByokKey({ prisma: _mockPrisma(new Map(), models), coreApi: _mockCoreApi(new Map()), operatorNamespace: _NS, provider: "openai", apiKey: "sk-test-123", log: _log, requireLiveModels: true })).rejects.toThrow(/more than one default/);
    }
    finally
    {
      vi.unstubAllGlobals();
      delete process.env.LITELLM_ENDPOINT;
      delete process.env.LITELLM_MASTER_KEY;
    }
  });

  it("deprovisions: clears the fixed Secret, removes the credential row, and can be re-provisioned", async function _deprovision()
  {
    const creds = new Map<string, Row>([["cred-1", { id: "cred-1", scope: "Global", clusterTenant: null, provider: "openai" }]]);
    const secrets = new Map<string, k8s.V1Secret>([[_byokSecretName("openai"), { metadata: { name: _byokSecretName("openai"), namespace: _NS } }]]);

    await _DeprovisionByokKey({ prisma: _mockPrisma(creds, new Map()), coreApi: _mockCoreApi(secrets), operatorNamespace: _NS, provider: "openai" });

    expect(secrets.has(_byokSecretName("openai"))).toBe(true);
    expect(Buffer.from(secrets.get(_byokSecretName("openai"))!.data!.apiKey, "base64").toString("utf8")).toBe("");
    expect(creds.size).toBe(0);

    await _ProvisionByokKey({ prisma: _mockPrisma(creds, new Map()), coreApi: _mockCoreApi(secrets), operatorNamespace: _NS, provider: "openai", apiKey: "sk-readded", log: _log });
    expect(Buffer.from(secrets.get(_byokSecretName("openai"))!.data!.apiKey, "base64").toString("utf8")).toBe("sk-readded");
  });

  it("strict bootstrap replaces persisted placeholder model ids with live LiteLLM deployment ids", async function _reconcileLiveIds()
  {
    const creds = new Map<string, Row>();
    const models = new Map<string, Row>();
    const secrets = new Map<string, k8s.V1Secret>();
    const prisma = _mockPrisma(creds, models);
    const coreApi = _mockCoreApi(secrets);

    await _ProvisionByokKey({ prisma, coreApi, operatorNamespace: _NS, provider: "openai", apiKey: "sk-first", log: _log });
    expect(Array.from(models.values()).every(function _placeholder(row) { return (row.litellmModelId as string).startsWith("placeholder:"); })).toBe(true);

    process.env.LITELLM_ENDPOINT = "http://litellm:4000";
    process.env.LITELLM_MASTER_KEY = "sk-master";
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async function _fetch(url: string)
    {
      if (url.endsWith("/credentials")) return new Response("{}", { status: 200 });
      if (url.endsWith("/model/new")) return new Response(JSON.stringify({ model_id: `live-${Math.random()}` }), { status: 200 });
      if (url.endsWith("/model/info")) return new Response(JSON.stringify({ data: [{ model_name: "auto" }] }), { status: 200 });
      return new Response("not found", { status: 404 });
    }));

    await _ProvisionByokKey({ prisma, coreApi, operatorNamespace: _NS, provider: "openai", apiKey: "sk-second", log: _log, requireLiveModels: true });
    expect(Array.from(models.values()).every(function _live(row) { return (row.litellmModelId as string).startsWith("live-"); })).toBe(true);
    vi.unstubAllGlobals();
    delete process.env.LITELLM_ENDPOINT;
    delete process.env.LITELLM_MASTER_KEY;
  });
});
