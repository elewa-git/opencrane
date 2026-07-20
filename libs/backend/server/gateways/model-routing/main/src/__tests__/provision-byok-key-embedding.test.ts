import { Buffer } from "node:buffer";

import * as k8s from "@kubernetes/client-node";
import type { Logger } from "pino";
import type { PrismaClient } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { _ProvisionByokKey, _AUTO_EMBEDDING_MODEL_NAME } from "../core/provision-byok-key.js";

/**
 * Covers `_ensureProviderEmbeddingModel` (the embedding-registration step added alongside the
 * Cognee LiteLLM wiring) — exercised through the public `_ProvisionByokKey` entry point, the same
 * way `provision-byok-key.test.ts` covers the chat-model seeding step. Unlike that suite, THIS one
 * sets `LITELLM_ENDPOINT`/`LITELLM_MASTER_KEY` so the live registration path actually runs and the
 * embedding-specific request shape + idempotency check can be asserted.
 */

type Row = Record<string, unknown>;

const _log = { info() { /* noop */ }, warn() { /* noop */ }, debug() { /* noop */ } } as unknown as Logger;

function _mockPrisma(): PrismaClient
{
  const creds = new Map<string, Row>();
  const models = new Map<string, Row>();
  let credSeq = 0;
  let modelSeq = 0;
  return {
    providerCredential: {
      findFirst: async function _f(args: { where: { provider?: string } }) { return Array.from(creds.values()).find(function _m(r) { return r.provider === args.where.provider; }) ?? null; },
      create: async function _c(args: { data: Row }) { const id = `cred-${++credSeq}`; const row = { id, ...args.data }; creds.set(id, row); return row; },
      update: async function _u(args: { where: { id: string }; data: Row }) { const row = { ...(creds.get(args.where.id) as Row), ...args.data }; creds.set(args.where.id, row); return row; },
    },
    modelDefinition: {
      findFirst: async function _mf(args: { where: Record<string, unknown> }) { return Array.from(models.values()).find(function _m(r) { return (args.where.publicModelName === undefined || r.publicModelName === args.where.publicModelName) && (args.where.isDefault === undefined || r.isDefault === args.where.isDefault); }) ?? null; },
      create: async function _mc(args: { data: Row }) { const id = `model-${++modelSeq}`; const row = { id, isDefault: false, providerCredentialId: null, ...args.data }; models.set(id, row); return row; },
      update: async function _mu(args: { where: { id: string }; data: Row }) { const row = { ...(models.get(args.where.id) as Row), ...args.data }; models.set(args.where.id, row); return row; },
    },
  } as unknown as PrismaClient;
}

function _mockCoreApi(): k8s.CoreV1Api
{
  const secrets = new Map<string, k8s.V1Secret>();
  const notFound = () => Object.assign(new Error("not found"), { code: 404 });
  return {
    readNamespacedSecret: async function _r(a: { name: string }) { const s = secrets.get(a.name); if (!s) { throw notFound(); } return s; },
    createNamespacedSecret: async function _c(a: { body: k8s.V1Secret }) { secrets.set(a.body.metadata!.name!, a.body); return a.body; },
    replaceNamespacedSecret: async function _rp(a: { name: string; body: k8s.V1Secret }) { secrets.set(a.name, a.body); return a.body; },
  } as unknown as k8s.CoreV1Api;
}

/** Route every fetch call by URL/method so `/credentials` and `/model/new` always succeed generically. */
function _routedFetch(modelInfoData: Array<{ model_name: string }>): ReturnType<typeof vi.fn>
{
  return vi.fn().mockImplementation(async function _fetch(url: string, init?: RequestInit)
  {
    if (url.includes("/model/info"))
    {
      return new Response(JSON.stringify({ data: modelInfoData }), { status: 200 });
    }
    if (url.includes("/credentials"))
    {
      return new Response(JSON.stringify({}), { status: 200 });
    }
    if (url.includes("/model/new"))
    {
      return new Response(JSON.stringify({ model_id: `id-${Math.random()}` }), { status: 200 });
    }
    void init;
    return new Response("not found", { status: 404 });
  });
}

/** Parse the JSON body of a recorded fetch call. */
function _bodyOf(call: unknown[]): Record<string, unknown>
{
  const init = call[1] as RequestInit;
  return JSON.parse(init.body as string) as Record<string, unknown>;
}

describe("_ProvisionByokKey — embedding model registration", function _suite()
{
  const _saved: Record<string, string | undefined> = {};

  beforeEach(function _setEnv()
  {
    _saved.LITELLM_ENDPOINT = process.env.LITELLM_ENDPOINT;
    _saved.LITELLM_MASTER_KEY = process.env.LITELLM_MASTER_KEY;
    process.env.LITELLM_ENDPOINT = "http://litellm:4000";
    process.env.LITELLM_MASTER_KEY = "sk-master";
  });

  afterEach(function _restoreEnv()
  {
    for (const k of ["LITELLM_ENDPOINT", "LITELLM_MASTER_KEY"])
    {
      if (_saved[k] === undefined) { delete process.env[k]; } else { process.env[k] = _saved[k]; }
    }
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("registers openai's embedding model with mode:'embedding', explicitly tagged", async function _registers()
  {
    const fetchMock = _routedFetch([]);
    vi.stubGlobal("fetch", fetchMock);

    await _ProvisionByokKey({ prisma: _mockPrisma(), coreApi: _mockCoreApi(), operatorNamespace: "default", provider: "openai", apiKey: "sk-test", log: _log });

    const registerCalls = fetchMock.mock.calls.filter(function _isNewModel(c) { return (c[0] as string).includes("/model/new"); });
    const embeddingCall = registerCalls.find(function _isEmbedding(c) { return _bodyOf(c)["model_name"] === "openai/text-embedding-3-large"; });
    expect(embeddingCall).toBeDefined();
    const body = _bodyOf(embeddingCall!);
    expect(body["model_info"]).toEqual({ mode: "embedding" });
    expect((body["litellm_params"] as Record<string, unknown>)["model"]).toBe("openai/text-embedding-3-large");
  });

  it("registers the stable auto-embedding alias pointing at the provider's real embedding upstream", async function _alias()
  {
    const fetchMock = _routedFetch([]);
    vi.stubGlobal("fetch", fetchMock);

    await _ProvisionByokKey({ prisma: _mockPrisma(), coreApi: _mockCoreApi(), operatorNamespace: "default", provider: "openai", apiKey: "sk-test", log: _log });

    const registerCalls = fetchMock.mock.calls.filter(function _isNewModel(c) { return (c[0] as string).includes("/model/new"); });
    const aliasCall = registerCalls.find(function _isAlias(c) { return _bodyOf(c)["model_name"] === _AUTO_EMBEDDING_MODEL_NAME; });
    expect(aliasCall).toBeDefined();
    const body = _bodyOf(aliasCall!);
    expect(body["model_info"]).toEqual({ mode: "embedding" });
    // The alias resolves to the provider's REAL embedding upstream (not to itself), so the proxy
    // routes it to OpenAI on the BYOK credential — exactly how the chat `auto` alias works.
    expect((body["litellm_params"] as Record<string, unknown>)["model"]).toBe("openai/text-embedding-3-large");
  });

  it("does NOT create a ModelDefinition row for the embedding model OR the alias (never tenant-selectable)", async function _noRow()
  {
    vi.stubGlobal("fetch", _routedFetch([]));

    const prisma = _mockPrisma();
    await _ProvisionByokKey({ prisma, coreApi: _mockCoreApi(), operatorNamespace: "default", provider: "openai", apiKey: "sk-test", log: _log });

    // The chat-model seeding path (provision-byok-key.test.ts) already asserts the 3 catalog
    // classes + "auto" get ModelDefinition rows; this asserts BOTH embedding deployments (the real
    // slug AND the auto-embedding alias) get NONE — neither may surface as a tenant-selectable chat
    // model (see ByokProviderCatalog.embeddingModel).
    const embeddingRow = await prisma.modelDefinition.findFirst({ where: { publicModelName: "openai/text-embedding-3-large" } } as never);
    expect(embeddingRow).toBeNull();
    const aliasRow = await prisma.modelDefinition.findFirst({ where: { publicModelName: _AUTO_EMBEDDING_MODEL_NAME } } as never);
    expect(aliasRow).toBeNull();
  });

  it("skips re-registration of BOTH the embedding model and the alias when /model/info lists them (idempotent)", async function _idempotent()
  {
    const fetchMock = _routedFetch([{ model_name: "openai/text-embedding-3-large" }, { model_name: _AUTO_EMBEDDING_MODEL_NAME }]);
    vi.stubGlobal("fetch", fetchMock);

    await _ProvisionByokKey({ prisma: _mockPrisma(), coreApi: _mockCoreApi(), operatorNamespace: "default", provider: "openai", apiKey: "sk-test", log: _log });

    const registerCalls = fetchMock.mock.calls.filter(function _isNewModel(c) { return (c[0] as string).includes("/model/new"); });
    const embeddingNames = registerCalls
      .map(function _n(c) { return _bodyOf(c)["model_name"]; })
      .filter(function _e(n) { return n === "openai/text-embedding-3-large" || n === _AUTO_EMBEDDING_MODEL_NAME; });
    expect(embeddingNames).toHaveLength(0);
  });

  it("still registers the alias when only the real embedding slug is already present (independent idempotency)", async function _aliasOnlyMissing()
  {
    const fetchMock = _routedFetch([{ model_name: "openai/text-embedding-3-large" }]);
    vi.stubGlobal("fetch", fetchMock);

    await _ProvisionByokKey({ prisma: _mockPrisma(), coreApi: _mockCoreApi(), operatorNamespace: "default", provider: "openai", apiKey: "sk-test", log: _log });

    const registerCalls = fetchMock.mock.calls.filter(function _isNewModel(c) { return (c[0] as string).includes("/model/new"); });
    // Real slug already present ⇒ skipped; alias absent ⇒ registered.
    expect(registerCalls.find(function _s(c) { return _bodyOf(c)["model_name"] === "openai/text-embedding-3-large"; })).toBeUndefined();
    expect(registerCalls.find(function _a(c) { return _bodyOf(c)["model_name"] === _AUTO_EMBEDDING_MODEL_NAME; })).toBeDefined();
  });

  it("does not register any embedding model for a provider with none catalogued (anthropic)", async function _noneCatalogued()
  {
    const fetchMock = _routedFetch([]);
    vi.stubGlobal("fetch", fetchMock);

    await _ProvisionByokKey({ prisma: _mockPrisma(), coreApi: _mockCoreApi(), operatorNamespace: "default", provider: "anthropic", apiKey: "sk-test", log: _log });

    const infoCalls = fetchMock.mock.calls.filter(function _isInfo(c) { return (c[0] as string).includes("/model/info"); });
    expect(infoCalls).toHaveLength(0);
  });

  it("does not crash the set when embedding registration fails (best-effort, non-fatal)", async function _resilient()
  {
    const fetchMock = vi.fn().mockImplementation(async function _fetch(url: string)
    {
      if (url.includes("/model/new") && url === "http://litellm:4000/model/new")
      {
        // Fail every /model/new call, including the embedding one.
        return new Response("boom", { status: 500 });
      }
      if (url.includes("/model/info"))
      {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      _ProvisionByokKey({ prisma: _mockPrisma(), coreApi: _mockCoreApi(), operatorNamespace: "default", provider: "openai", apiKey: "sk-test", log: _log }),
    ).resolves.toBeDefined();
  });
});
