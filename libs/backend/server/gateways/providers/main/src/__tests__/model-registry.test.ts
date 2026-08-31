import express from "express";
import type { Express } from "express";
import type { Prisma, PrismaClient } from "@prisma/client";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import type { ModelRoutingScope } from "@opencrane/contracts";

// Side-effect import: loads the express-session SessionData.authUser augmentation.
import "@opencrane/backend/server/infra/auth";
import type { AuthUser } from "@opencrane/backend/server/infra/auth";
import { ProviderEffectCommandKinds, ProviderEffectExecutionStatuses, type ProviderEffectCommandExecutor } from "../provider-effect-command.types";
import type { ProviderGatewayAuthorizationFactory } from "../provider-gateway-authority.types";
import { modelRegistryRouter } from "../model-registry-composition";

/** In-memory model_definitions store backing the mock Prisma client. */
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

/** Build a Prisma stub over an in-memory map keyed by model id, with optional credential rows. */
function _mockPrisma(store: Map<string, Row>, credentials: Map<string, Row> = new Map(), commands: Map<string, Row> = new Map()): PrismaClient
{
  let seq = 0;
	function _id(where: { id?: string; id_siloId?: { id: string; siloId: string } }): string
	{
		return where.id_siloId?.id ?? where.id!;
	}
	const client = {
    modelDefinition: {
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
	  findFirst: async function _findFirst(args: { where: { publicModelName?: string; providerCredentialId?: string; upstreamModel?: string } })
	  {
		return Array.from(store.values()).find(function _Matches(row)
		{
			return (args.where.publicModelName === undefined || row.publicModelName === args.where.publicModelName)
				&& (args.where.providerCredentialId === undefined || row.providerCredentialId === args.where.providerCredentialId)
				&& (args.where.upstreamModel === undefined || row.upstreamModel === args.where.upstreamModel);
		}) ?? null;
	  },
      create: async function _create(args: { data: Row })
      {
        const id = `model-${++seq}`;
        const now = new Date("2026-06-18T00:00:00.000Z");
		const row = { id, siloId: "acme", apiBase: null, isDefault: false, providerCredentialId: null, generatedOutputCapabilities: [], clusterTenant: null, createdAt: now, updatedAt: now, ...args.data };
        store.set(row.id as string, row);
        return row;
      },
		update: vi.fn(async function _update(args: { where: { id?: string; id_siloId?: { id: string; siloId: string } }; data: Row })
      {
		const id = _id(args.where);
		const row = { ...(store.get(id) as Row), ...args.data, updatedAt: new Date() };
		store.set(id, row);
        return row;
	      }),
		delete: vi.fn(async function _delete(args: { where: { id?: string; id_siloId?: { id: string; siloId: string } } }) { store.delete(_id(args.where)); return {}; }),
    },
    providerCredential: {
		findUnique: async function _findCred(args: { where: { id?: string; id_siloId?: { id: string; siloId: string } } })
		{
			const row = credentials.get(_id(args.where)) ?? null;
			return row !== null && (args.where.id_siloId === undefined || (row.siloId ?? "acme") === args.where.id_siloId.siloId) ? row : null;
		},
    },
	modelRoutingDefault: {
	  findFirst: async function _findDefault() { return null; },
	},
    providerEffectCommand: {
      _commands: commands,
	  findFirst: async function _findCurrentCommand(args: { where: { siloId: string; resourceKind: string; resourceId: string; state?: string | { in: string[] } } })
	  {
		return Array.from(commands.values())
			.filter(function _Same(row)
			{
				if (row.siloId !== args.where.siloId || row.resourceKind !== args.where.resourceKind || row.resourceId !== args.where.resourceId)
					return false;
				if (typeof args.where.state === "string")
					return row.state === args.where.state;
				return args.where.state === undefined || args.where.state.in.includes(row.state as string);
			})
			.sort(function _Newest(left, right) { return Number(right.desiredGeneration ?? 0) - Number(left.desiredGeneration ?? 0); })[0] ?? null;
	  },
      create: async function _createCommand(args: { data: Row })
      {
        const now = new Date("2026-06-18T00:00:00.000Z");
        const row: Row = { state: "Pending", deliveryCount: 0, claimFence: null, claimExpiresAt: null, result: null, failureCode: null, completedAt: null, createdAt: now, updatedAt: now, ...args.data };
        commands.set(row.id as string, row);
        return row;
      },
	  updateMany: async function _supersedeCommands() { return { count: 0 }; },
    },
  } as unknown as PrismaClient;
	Object.assign(client, { $transaction: vi.fn(async function _Transaction(operation: (transaction: PrismaClient) => Promise<unknown>) { return operation(client); }) });
	return client;
}

/** Central authority stub that admits mutations and returns every catalogue candidate. */
const _ALLOW_AUTHORIZATION = (function _CreateAuthorization()
{
	return {
		admitPrincipal: async function _Admit() { return { outcome: "allow", evidence: { decisionDigest: "sha256:decision", policyRevisionHash: "sha256:policy", effectiveAuthorizationDigest: "sha256:effective" } }; },
		listPrincipalEntitled: async function _List(command: { resources: readonly unknown[] }) { return command.resources; },
		replaceManagedGrants: async function _Replace() { return { outcome: "allow", changedCount: 1, evidence: {} }; },
	};
}) as unknown as ProviderGatewayAuthorizationFactory<Prisma.TransactionClient>;

/** Build a minimal app mounting the model-registry router with an authenticated operator session. */
function _buildApp(prisma: PrismaClient, user: AuthUser | null = _platformOperator(), authorization: ProviderGatewayAuthorizationFactory<Prisma.TransactionClient> = _ALLOW_AUTHORIZATION, injectedExecutor: ProviderEffectCommandExecutor | null = null): Express
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
	const executor = injectedExecutor ?? {
	reconcileNext: async function _ReconcileNext() { return false; },
    execute: async function _Execute(commandId: string)
    {
      const command = (prisma as unknown as { providerEffectCommand: { _commands?: Map<string, Row> } }).providerEffectCommand._commands?.get(commandId);
      if (!command)
        throw new Error("test command was not captured");
      const payload = command.payload as { modelDefinitionId: string; publicModelName: string; upstreamModel: string; scope: ModelRoutingScope; clusterTenant: string | null; apiBase: string | null; apiKeyEnvRef: string | null; litellmCredentialName: string | null };
	  const litellmModelId = `deployment:${commandId}`;
      await prisma.modelDefinition.update({ where: { id: payload.modelDefinitionId }, data: { litellmModelId } });
      return { status: ProviderEffectExecutionStatuses.Succeeded, result: { kind: ProviderEffectCommandKinds.RegisterModel, litellmModelId } };
    },
	  } as ProviderEffectCommandExecutor;
  app.use("/api/v1/models", modelRegistryRouter(prisma, executor, resolveCaller, authorization));
  return app;
}

describe("modelRegistryRouter", function _suite()
{
	it("filters exact ModelDefinition reads and admits mutation as organisation policy", async function _CentralAuthority()
	{
		const store = new Map<string, Row>([
			["model-1", { id: "model-1", siloId: "acme", scope: "Global", clusterTenant: null, publicModelName: "custom/openai", litellmModelId: "x", upstreamModel: "openai/gpt-4o", apiBase: null, isDefault: false, providerCredentialId: null, generatedOutputCapabilities: [], createdAt: new Date(), updatedAt: new Date() }],
			["model-2", { id: "model-2", siloId: "acme", scope: "Global", clusterTenant: null, publicModelName: "custom/anthropic", litellmModelId: "y", upstreamModel: "anthropic/claude", apiBase: null, isDefault: false, providerCredentialId: null, generatedOutputCapabilities: [], createdAt: new Date(), updatedAt: new Date() }],
		]);
			const listPrincipalEntitled = vi.fn(async function _List(command: { resources: readonly { id: string }[] }) { return command.resources.filter(resource => resource.id !== "model-1"); });
		const admitPrincipal = vi.fn(async function _Admit() { return { outcome: "allow", evidence: { decisionDigest: "sha256:decision", policyRevisionHash: "sha256:policy", effectiveAuthorizationDigest: "sha256:effective" } }; });
		const replaceManagedGrants = vi.fn(async function _Replace() { return { outcome: "allow" }; });
		const factory = (function _CreateAuthorization() { return { listPrincipalEntitled, admitPrincipal, replaceManagedGrants }; }) as unknown as ProviderGatewayAuthorizationFactory<Prisma.TransactionClient>;
		const app = _buildApp(_mockPrisma(store), _platformOperator(), factory);

		const list = await request(app).get("/api/v1/models");
		const created = await request(app).post("/api/v1/models").send({ publicModelName: "custom/gemini", upstreamModel: "gemini/gemini" });

		expect(list.body.map((row: { id: string }) => row.id)).toEqual(["model-2"]);
		expect(listPrincipalEntitled).toHaveBeenCalledWith(expect.objectContaining({ siloId: "acme", principalId: "principal-1", action: "read", resources: [{ kind: "model-definition", id: "model-1" }, { kind: "model-definition", id: "model-2" }] }));
		expect(created.status).toBe(201);
		expect(admitPrincipal).toHaveBeenCalledWith(expect.objectContaining({ action: "administer", resource: { kind: "organization", id: "acme" } }));
		expect(replaceManagedGrants).toHaveBeenCalledWith(expect.objectContaining({
			resource: { kind: "model-definition", id: expect.any(String) },
			grants: expect.arrayContaining([expect.objectContaining({ capability: expect.objectContaining({ capabilityId: "model-definition:use" }) })]),
		}));
	});

  it("lists models", async function _list()
  {
    const store = new Map<string, Row>([
      ["model-1", { id: "model-1", scope: "Global", clusterTenant: null, publicModelName: "openai/gpt-4o", litellmModelId: "placeholder:openai-gpt-4o", upstreamModel: "openai/gpt-4o", apiBase: null, isDefault: false, providerCredentialId: null, createdAt: new Date(), updatedAt: new Date() }],
    ]);
    const res = await request(_buildApp(_mockPrisma(store))).get("/api/v1/models");

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].publicModelName).toBe("openai/gpt-4o");
  });

  it("returns the model only after the injected executor finalizes registration", async function _createFinalized()
  {
	const res = await request(_buildApp(_mockPrisma(new Map()))).post("/api/v1/models").send({ publicModelName: "custom/gpt-4o", upstreamModel: "openai/gpt-4o" });

    expect(res.status).toBe(201);
	expect(res.body.litellmModelId).toMatch(/^deployment:/);
    expect(res.body.scope).toBe("global");
  });

	it("refuses a terminal registration replay after the model read grant is revoked", async function _RevokedTerminalRead()
	{
		const store = new Map<string, Row>([["model-1", { id: "model-1", siloId: "acme", scope: "Global", clusterTenant: null, publicModelName: "custom/gpt-4o", litellmModelId: "deployment:model-1", upstreamModel: "openai/gpt-4o", apiBase: null, isDefault: false, providerCredentialId: null, generatedOutputCapabilities: [], createdAt: new Date(), updatedAt: new Date() }]]);
		const authorization = (function _CreateAuthorization()
		{
			return { listPrincipalEntitled: async function _DenyRead() { return []; } };
		}) as unknown as ProviderGatewayAuthorizationFactory<Prisma.TransactionClient>;
		const executor = { reconcileNext: async function _ReconcileNext() { return false; }, execute: async function _AlreadySucceeded() { return { status: ProviderEffectExecutionStatuses.AlreadySucceeded, result: null }; } } as ProviderEffectCommandExecutor;
		const app = _buildApp(_mockPrisma(store), _platformOperator(), authorization, executor);

		const response = await request(app).post("/api/v1/models/model-1/registration-commands/command-1");

		expect(response.status).toBe(403);
		expect(response.body.code).toBe("FORBIDDEN");
	});

  it("persists only the explicit generated-output capability allowlist", async function _GeneratedOutputCapabilities()
  {
    const app = _buildApp(_mockPrisma(new Map()));
	const accepted = await request(app).post("/api/v1/models").send({ publicModelName: "custom/gpt-4o", upstreamModel: "openai/gpt-4o", generatedOutputCapabilities: ["image_png", "code_execution_files"] });
    const refused = await request(app).post("/api/v1/models").send({ publicModelName: "openai/gpt-4o-mini", upstreamModel: "openai/gpt-4o-mini", generatedOutputCapabilities: ["code_execution"] });

    expect(accepted.status).toBe(201);
    expect(accepted.body.generatedOutputCapabilities).toEqual(["image_png", "code_execution_files"]);
    expect(refused.status).toBe(400);
    expect(refused.body.code).toBe("VALIDATION_ERROR");
  });

  it("rejects a model that references a credential owned by another ClusterTenant (400)", async function _credentialScopeMismatch()
  {
    const credentials = new Map<string, Row>([
	  ["cred-b", { id: "cred-b", siloId: "acme", scope: "ClusterTenant", clusterTenant: "tenant-b", provider: "openai", secretRef: "k" }],
    ]);
    const res = await request(_buildApp(_mockPrisma(new Map(), credentials)))
      .post("/api/v1/models")
	  .send({ scope: "clusterTenant", clusterTenant: "tenant-a", publicModelName: "custom/gpt-4o", upstreamModel: "openai/gpt-4o", providerCredentialId: "cred-b" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("CREDENTIAL_SCOPE_MISMATCH");
  });

  it("allows a model to bind a Global credential", async function _globalCredentialAllowed()
  {
    const credentials = new Map<string, Row>([
	  ["cred-g", { id: "cred-g", siloId: "acme", scope: "Global", clusterTenant: null, provider: "openai", secretRef: "openai-key" }],
    ]);
    const res = await request(_buildApp(_mockPrisma(new Map(), credentials)))
      .post("/api/v1/models")
	  .send({ scope: "clusterTenant", clusterTenant: "tenant-a", publicModelName: "custom/gpt-4o", upstreamModel: "openai/gpt-4o", providerCredentialId: "cred-g" });

    expect(res.status).toBe(201);
    expect(res.body.providerCredentialId).toBe("cred-g");
  });

  it("rejects a model that references a non-existent credential (400)", async function _missingCredential()
  {
    const res = await request(_buildApp(_mockPrisma(new Map())))
      .post("/api/v1/models")
      .send({ publicModelName: "openai/gpt-4o", upstreamModel: "openai/gpt-4o", providerCredentialId: "nope" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });

  it("rejects a missing required field with 400", async function _missingRequired()
  {
    const res = await request(_buildApp(_mockPrisma(new Map()))).post("/api/v1/models").send({ publicModelName: "openai/gpt-4o" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });

  it("rejects clusterTenant scope without a clusterTenant with 400", async function _missingClusterTenant()
  {
    const res = await request(_buildApp(_mockPrisma(new Map()))).post("/api/v1/models").send({ scope: "clusterTenant", publicModelName: "openai/gpt-4o", upstreamModel: "openai/gpt-4o" });

    expect(res.status).toBe(400);
	expect(res.body.code).toBe("VALIDATION_ERROR");
  });

	it.each([
		{ apiBase: 42 },
		{ providerCredentialId: { id: "credential-1" } },
		{ scope: "clusterTenant", clusterTenant: 42 },
		{ scope: "clusterTenant", clusterTenant: "tenant-a", isDefault: true },
	] as const)("rejects malformed typed creation input before Prisma sees it: %j", async function _RejectsMalformedType(malformed)
	{
		const prisma = _mockPrisma(new Map());
		const response = await request(_buildApp(prisma)).post("/api/v1/models").send({ publicModelName: "custom/model", upstreamModel: "openai/model", ...malformed });

		expect(response.status).toBe(400);
		expect(prisma.$transaction).not.toHaveBeenCalled();
	});

  it("returns 404 for an unknown model", async function _get404()
  {
    const res = await request(_buildApp(_mockPrisma(new Map()))).get("/api/v1/models/nope");

    expect(res.status).toBe(404);
    expect(res.body.code).toBe("MODEL_DEFINITION_NOT_FOUND");
  });

	it.each(["auto", "auto-embedding", "openai/gpt-5.5", "openai/text-embedding-3-large"])("reserves the governed global model name %s", async function _ReservesGovernedNames(publicModelName)
	{
		const response = await request(_buildApp(_mockPrisma(new Map()))).post("/api/v1/models").send({ publicModelName, upstreamModel: publicModelName });

		expect(response.status).toBe(400);
		expect(response.body.code).toBe("MODEL_NAME_RESERVED");
	});
});
