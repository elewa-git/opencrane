import { createHash } from "node:crypto";

import express from "express";
import type { Express } from "express";
import type { PrismaClient } from "@prisma/client";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const _authorizationAuthority = vi.hoisted(function _Authority()
{
	return { admitPrincipal: vi.fn(), constructedWith: vi.fn(), listPrincipalEntitled: vi.fn() };
});

vi.mock("@opencrane/backend/server/iam/authorization", async function _mockAuthorization()
{
  const actual = await vi.importActual("@opencrane/backend/server/iam/authorization");
	return {
		...actual,
		PrismaAuthorizationAuthority: class _PrismaAuthorizationAuthority
		{
			constructor(transaction: unknown) { _authorizationAuthority.constructedWith(transaction); }
			admitPrincipal(command: unknown) { return _authorizationAuthority.admitPrincipal(command); }
			listPrincipalEntitled(command: ListPrincipalEntitledProductResourcesCommand) { return _authorizationAuthority.listPrincipalEntitled(command); }
		},
	};
});

import type { ListPrincipalEntitledProductResourcesCommand } from "@opencrane/backend/server/iam/authorization";
import type { AuthenticatedPrincipalDirectory } from "@opencrane/backend/server/iam/identity";
import { ProductAuthorizationActions, ProductAuthorizationResourceKinds } from "@opencrane/models/authorization";
import { mcpOperatorRouter } from "../routes/mcp-operator";
import { PrismaMcpOperatorUnitOfWork } from "../core/prisma-mcp-operator-unit-of-work";
import { McpEraProbeStates } from "../era-probe/mcp-era-probe.types";
import type { McpEraProbeWorkflow } from "../era-probe/mcp-era-probe.types";
import type { OciImageLayoutArtifactResolver } from "../oci-image-validation/oci-image-validation-submission.types";
import type { OciImageValidationWorkflow } from "../oci-image-validation/oci-image-validation.types";

/**
 * Covers the MCP operator routes: current Organization/Administer grants, published entries filtered
 * by authorization, install states selected by server type, and install scoping to the local Principal.
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

/** Session user shape seeded onto the request (mirrors the OIDC session). */
interface _SessionUser
{
  /** Stable subject identifier. */
  sub?: string;
  /** Identity provider that issued the verified login. */
  issuer?: string;
  /** Caller email (used when sub is absent). */
  email?: string;
  /** IdP group claims. */
  groups?: string[];
  /** Legacy identity-role projection retained by the session fixture; the central grant remains authoritative. */
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
      if (model === "$transaction")
        return async function _Transaction(callback: (transaction: PrismaClient) => Promise<unknown>) { return callback(prisma); };
      return new Proxy({}, {
        get(_t2, method)
        {
          const key = `${String(model)}.${String(method)}`;
          if (!spies[key])
          {
            if (overrides[key])
              spies[key] = vi.fn(overrides[key]);
            else if (key === "principal.findUnique")
              spies[key] = vi.fn().mockResolvedValue({ id: "principal-1" });
            else spies[key] = vi.fn().mockResolvedValue([]);
          }
          return spies[key];
        },
      });
    },
  }) as unknown as PrismaClient;
  return { prisma, spies };
}

/** Mount the operator router, optionally seeding a session user. */
function _buildApp(prisma: PrismaClient, user?: _SessionUser, eraProbeWorkflow: McpEraProbeWorkflow = _EraProbeWorkflow()): Express
{
  const app = express();
  app.use(express.json());
  if (user)
  {
    app.use(function _seedAuthenticatedPrincipal(req, _res, next)
    {
      req.session = { authUser: { ...user, sub: user.sub ?? "subject-1", issuer: user.issuer ?? "https://issuer.example.test", groups: user.groups ?? [], isPlatformOperator: false, isOrgAdmin: user.isOrgAdmin ?? false, authenticatedAt: "2026-08-21T00:00:00.000Z" } } as typeof req.session;
      req.authenticatedPrincipal = { principalId: "principal-1", siloId: "silo-1", issuer: "https://issuer.example.test", subject: user.sub ?? "subject-1" };
      req.headers["x-forwarded-host"] = "silo-1.opencrane.test";
      next();
    });
  }
  const directory: AuthenticatedPrincipalDirectory = { resolveAuthenticatedPrincipal: vi.fn().mockResolvedValue({ siloId: "silo-1", principalId: "principal-1" }) };
  app.use("/api/v1/mcp", mcpOperatorRouter(new PrismaMcpOperatorUnitOfWork(prisma), directory, eraProbeWorkflow, _OciImageWorkflow(), _OciImageArtifacts()));
  return app;
}

/** Return a task admission stub for router cases that do not exercise registration. */
function _EraProbeWorkflow(): McpEraProbeWorkflow
{
  return {
    admit: vi.fn().mockResolvedValue({ taskKey: "workflows:mcp-era-probe:test", receipt: { taskId: "task-1", taskName: "mcp-era-probe.probe", idempotencyKey: "workflows:mcp-era-probe:test" } }),
  };
}

/** Return OCI image task admission for router cases that do not exercise image submission. */
function _OciImageWorkflow(): OciImageValidationWorkflow
{
	return { admit: vi.fn().mockResolvedValue({ taskKey: "workflows:oci-image-validation:test", receipt: { taskId: "task-2", taskName: "oci-image-validation.verify", idempotencyKey: "workflows:oci-image-validation:test" } }) };
}

/** Return no artifact for router cases that do not exercise OCI image submission. */
function _OciImageArtifacts(): OciImageLayoutArtifactResolver
{
	return { resolve: vi.fn().mockResolvedValue(null) };
}

/** Build one Ready server revision with a stable discovered tool for catalogue responses. */
function _ReadyRevision(serverRevisionId: string, toolRevisionId: string)
{
	return {
		id: serverRevisionId,
		state: "Ready",
		tools: [{ id: toolRevisionId, name: "search", description: null, inputSchema: { type: "object", properties: { query: { type: "string" } } }, inputSchemaDigest: `sha256:${"d".repeat(64)}` }],
	};
}

describe("mcp-operator router", function _suite()
{
  const _saved: Record<string, string | undefined> = {};

  /** Snapshots then clears the authentication environment so each case configures its own auth setup. */
  beforeEach(function _clearEnv()
  {
	_authorizationAuthority.admitPrincipal.mockReset().mockResolvedValue({ outcome: "allow", reason: "winning_allow", grantIds: ["grant-1"], evidence: { decisionDigest: `sha256:${"a".repeat(64)}`, policyRevisionHash: `sha256:${"b".repeat(64)}`, effectiveAuthorizationDigest: `sha256:${"c".repeat(64)}` } });
	_authorizationAuthority.constructedWith.mockReset();
	_authorizationAuthority.listPrincipalEntitled.mockReset().mockImplementation(async function _AllowAll(command: ListPrincipalEntitledProductResourcesCommand) { return command.resources; });
    for (const key of _AUTH_ENV) { _saved[key] = process.env[key]; delete process.env[key]; }
  });

  /** Restore the auth env captured in `beforeEach` so cases stay isolated. */
  afterEach(function _restoreEnv()
  {
    for (const key of _AUTH_ENV) { if (_saved[key] === undefined)
    { delete process.env[key]; } else { process.env[key] = _saved[key]; } }
  });

  describe("central authority on governance endpoints", function _gate()
  {
    it("denies GET /servers when the central authority has no administration grant", async function _denyList()
    {
      _enableOidc();
	  _authorizationAuthority.listPrincipalEntitled.mockResolvedValue([]);
      const { prisma, spies } = _mockPrisma();
      const res = await request(_buildApp(prisma, { sub: "u1", isOrgAdmin: false })).get("/api/v1/mcp/servers");

		expect(res.status).toBe(403);
	  expect(res.body).toMatchObject({ code: "FORBIDDEN" });
      expect(spies["mcpServer.findMany"]).toBeUndefined();
    });

    it("uses the central grant instead of the session administrator flag", async function _allowList()
    {
      _enableOidc();
      const { prisma, spies } = _mockPrisma();
      const res = await request(_buildApp(prisma, { sub: "admin", isOrgAdmin: false })).get("/api/v1/mcp/servers");

      expect(res.status).not.toBe(403);
      expect(spies["mcpServer.findMany"]).toHaveBeenCalled();
	  expect(_authorizationAuthority.listPrincipalEntitled).toHaveBeenCalledWith(expect.objectContaining({ action: ProductAuthorizationActions.Administer, resources: [{ kind: ProductAuthorizationResourceKinds.Organization, id: "silo-1" }] }));
    });

	it("shows an administrator a Ready tool without presenting a disabled server as assignable", async function _ShowsBlockedTool()
	{
		_enableOidc();
		const server = { id: "srv-disabled", name: "Disabled", description: "", publisher: null, glyph: null, serverType: "MultiUser", approvalStatus: "Disabled", status: "Active", revisions: [_ReadyRevision("revision-ready", "tool-ready")], credentialSchema: [], entitlementSummary: null, eraProbeStatus: McpEraProbeStates.Accepted };
		const { prisma } = _mockPrisma({ "mcpServer.findMany": function _FindMany() { return Promise.resolve([server]); } });

		const response = await request(_buildApp(prisma, { sub: "admin", isOrgAdmin: true })).get("/api/v1/mcp/servers");

		expect(response.status).toBe(200);
		expect(response.body[0].tools).toEqual([expect.objectContaining({ toolRevisionId: "tool-ready", serverRevisionId: "revision-ready", eligibility: "governance-blocked", readiness: "ready" })]);
	});

    it("refuses publication until an accepted server has been approved", async function _RequiresApprovalBeforePublish()
    {
      _enableOidc();
      const { prisma, spies } = _mockPrisma({ "mcpServer.updateMany": function _NoApprovedSource() { return Promise.resolve({ count: 0 }); } });

      const response = await request(_buildApp(prisma, { sub: "admin", isOrgAdmin: true })).post("/api/v1/mcp/servers/srv-1/publish");

      expect(response.status).toBe(404);
      expect(spies["mcpServer.updateMany"]).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ eraProbeStatus: { in: ["Accepted", "NotRequired"] }, approvalStatus: "Approved" }) }));
      expect(spies["auditEntry.create"]).toBeUndefined();
    });

    it("restores a disabled server when its saved protocol evidence remains accepted", async function _RestoresDisabledServer()
    {
      _enableOidc();
      const server = { id: "srv-1", name: "Server", description: "", publisher: null, glyph: null, serverType: "SingleUser", approvalStatus: "Published", status: "Active", revisions: [_ReadyRevision("revision-1", "tool-1")], credentialSchema: [], entitlementSummary: null, eraProbeStatus: McpEraProbeStates.Accepted };
      const { prisma, spies } = _mockPrisma({
        "mcpServer.updateMany": function _Update() { return Promise.resolve({ count: 1 }); },
        "mcpServer.findFirst": function _Find() { return Promise.resolve(server); },
        "auditEntry.create": function _Audit() { return Promise.resolve({}); },
      });

      const response = await request(_buildApp(prisma, { sub: "admin", isOrgAdmin: true })).post("/api/v1/mcp/servers/srv-1/enabled").send({ enabled: true });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ id: "srv-1", approvalStatus: "published" });
      expect(spies["mcpServer.updateMany"]).toHaveBeenCalledWith({ where: { id: "srv-1", siloId: "silo-1", eraProbeStatus: { in: ["Accepted", "NotRequired"] }, approvalStatus: "Disabled" }, data: { approvalStatus: "Published" } });
	  expect(spies["auditEntry.create"]).toHaveBeenCalledWith({ data: expect.objectContaining({ siloId: "silo-1", metadata: { actorPrincipalId: "principal-1" } }) });
    });

    it("fails closed when no session is established", async function _denyUnauthenticated()
    {
      const { prisma } = _mockPrisma();
      const res = await request(_buildApp(prisma)).get("/api/v1/mcp/servers");

      expect(res.status).toBe(401);
    });
  });

  describe("GET /catalog — published + entitled filtering", function _catalog()
  {
	/** Two published servers filtered by the central transaction-bound authority. */
    const _servers = [
      { id: "srv-open", name: "Open", description: "", publisher: null, glyph: null, serverType: "MultiUser", approvalStatus: "Published", status: "Active", revisions: [_ReadyRevision("revision-open", "tool-open")], credentialSchema: [], entitlementSummary: null, eraProbeStatus: McpEraProbeStates.NotRequired, createdAt: new Date() },
      { id: "srv-closed", name: "Closed", description: "", publisher: null, glyph: null, serverType: "SingleUser", approvalStatus: "Published", status: "Active", revisions: [_ReadyRevision("revision-closed", "tool-closed")], credentialSchema: [], entitlementSummary: null, eraProbeStatus: McpEraProbeStates.NotRequired, createdAt: new Date() },
    ];

    it("returns only the servers the caller is entitled to", async function _filters()
    {
      _enableOidc();
		_authorizationAuthority.listPrincipalEntitled.mockImplementation(async function _Entitled(command: ListPrincipalEntitledProductResourcesCommand) { return command.resources.filter(resource => resource.id === "srv-open"); });
      const { prisma } = _mockPrisma({ "mcpServer.findMany": function _findMany() { return Promise.resolve(_servers); } });
      const res = await request(_buildApp(prisma, { sub: "user-1", groups: [], isOrgAdmin: false })).get("/api/v1/mcp/catalog");

      expect(res.status).toBe(200);
      expect(res.body.map(function _id(s: { id: string }) { return s.id; })).toEqual(["srv-open"]);
      expect(res.body[0]).toMatchObject({ id: "srv-open", type: "multi-user", approvalStatus: "published" });
		expect(res.body[0].tools).toEqual([{
			toolRevisionId: "tool-open",
			serverRevisionId: "revision-open",
			name: "search",
			description: null,
			inputSchema: { type: "object", properties: { query: { type: "string" } } },
			inputSchemaDigest: `sha256:${"d".repeat(64)}`,
			eligibility: "assignable",
			readiness: "ready",
		}]);
		expect(_authorizationAuthority.listPrincipalEntitled).toHaveBeenCalledTimes(1);
		expect(_authorizationAuthority.listPrincipalEntitled).toHaveBeenCalledWith(expect.objectContaining({
			siloId: "silo-1",
			principalId: "principal-1",
			action: ProductAuthorizationActions.Discover,
			resources: [
				{ kind: ProductAuthorizationResourceKinds.McpServer, id: "srv-open" },
				{ kind: ProductAuthorizationResourceKinds.McpServer, id: "srv-closed" },
			],
		}));
    });

    it("does not pass raw OIDC group claims into authorization", async function _group()
    {
      _enableOidc();
      const { prisma } = _mockPrisma({ "mcpServer.findMany": function _findMany() { return Promise.resolve(_servers); } });
      const res = await request(_buildApp(prisma, { sub: "user-2", groups: ["group:untrusted"], isOrgAdmin: false })).get("/api/v1/mcp/catalog");

      expect(res.status).toBe(200);
      expect(res.body.map(function _id(s: { id: string }) { return s.id; }).sort()).toEqual(["srv-closed", "srv-open"]);
		expect(_authorizationAuthority.listPrincipalEntitled.mock.calls.every(function _NoClaims(call) { return !("groups" in call[0]); })).toBe(true);
    });
  });

  describe("POST /servers — remote registration", function _Registration()
  {
    it("saves the draft and admits its workflow through the same database transaction", async function _RegistersAtomically()
    {
      _enableOidc();
      const workflow = _EraProbeWorkflow();
      const server = { id: "srv-new", name: "Example MCP", description: "Public tools", publisher: null, glyph: null, serverType: "SingleUser", approvalStatus: "PendingReview", status: "Draft", revisions: [], credentialSchema: [], entitlementSummary: null, endpoint: "https://mcp.example.test/", registrationKeyDigest: `sha256:${"a".repeat(64)}`, registrationDigest: `sha256:${"b".repeat(64)}`, eraProbeStatus: "Pending", eraProtocolVersion: null, eraProbeEvidenceDigest: null, eraProbeFailureCode: null, eraProbeAttempts: 0 };
      const { prisma, spies } = _mockPrisma({
        "mcpRegistrationClaim.upsert": function _Claim(input: unknown) { return Promise.resolve((input as { create: unknown }).create); },
        "mcpServer.findUnique": function _FindUnique() { return Promise.resolve(null); },
        "mcpServer.create": function _Create(input: unknown) { return Promise.resolve({ ...server, ...(input as { data: object }).data }); },
        "auditEntry.create": function _Audit() { return Promise.resolve({}); },
      });

      const response = await request(_buildApp(prisma, { sub: "admin", isOrgAdmin: true }, workflow))
        .post("/api/v1/mcp/servers")
        .send({ idempotencyKey: "registration-1", name: "Example MCP", description: "Public tools", endpoint: "https://mcp.example.test/" });

      expect(response.status).toBe(201);
      expect(response.body).toEqual({ id: "srv-new", name: "Example MCP", endpoint: "https://mcp.example.test/", eraProbeStatus: "Pending" });
      expect(spies["mcpRegistrationClaim.upsert"]).toHaveBeenCalledTimes(2);
      expect(spies["mcpServer.create"]).toHaveBeenCalledTimes(1);
	  expect(spies["auditEntry.create"]).toHaveBeenCalledWith({ data: expect.objectContaining({ siloId: "silo-1", metadata: { actorPrincipalId: "principal-1" } }) });
      const [transaction, task] = vi.mocked(workflow.admit).mock.calls[0] as Parameters<McpEraProbeWorkflow["admit"]>;
      expect(transaction.client).toBe(prisma);
      expect(task).toEqual(expect.objectContaining({ siloId: "silo-1", serverId: "srv-new" }));
    });

		it("returns the current protocol state when an accepted registration is replayed", async function _ReplaysAcceptedRegistration()
		{
			_enableOidc();
			const workflow = _EraProbeWorkflow();
			const registrationDigest = `sha256:${createHash("sha256").update(JSON.stringify(["Example MCP", "Public tools", "https://mcp.example.test/"])).digest("hex")}`;
			const server = { id: "srv-new", name: "Example MCP", description: "Public tools", publisher: null, glyph: null, serverType: "SingleUser", approvalStatus: "PendingReview", status: "Active", revisions: [], credentialSchema: [], entitlementSummary: null, endpoint: "https://mcp.example.test/", registrationKeyDigest: `sha256:${"a".repeat(64)}`, registrationDigest, eraProbeStatus: "Accepted", eraProtocolVersion: "2026-07-28", eraProbeEvidenceDigest: `sha256:${"c".repeat(64)}`, eraProbeFailureCode: null, eraProbeAttempts: 1 };
			const { prisma, spies } = _mockPrisma({
				"mcpRegistrationClaim.upsert": function _Claim(input: unknown) { return Promise.resolve((input as { create: unknown }).create); },
				"mcpServer.findUnique": function _FindUnique() { return Promise.resolve(server); },
			});

			const response = await request(_buildApp(prisma, { sub: "admin", isOrgAdmin: true }, workflow))
				.post("/api/v1/mcp/servers")
				.send({ idempotencyKey: "registration-1", name: "Example MCP", description: "Public tools", endpoint: "https://mcp.example.test/" });

			expect(response.status).toBe(201);
			expect(response.body).toEqual({ id: "srv-new", name: "Example MCP", endpoint: "https://mcp.example.test/", eraProbeStatus: "Accepted" });
			expect(spies["mcpServer.findUnique"]).toHaveBeenCalledTimes(1);
			expect(workflow.admit).toHaveBeenCalledTimes(1);
		});
  });

  describe("install lifecycle", function _lifecycle()
  {
    /**
     * Stateful single-install store backing install requests.
     */
    function _statefulPrisma(serverType: string): { prisma: PrismaClient; store: { install: Record<string, unknown> | null } }
    {
      const store: { install: Record<string, unknown> | null } = { install: null };
      const overrides: Record<string, (...args: unknown[]) => unknown> = {
        "mcpServer.findFirst": function _serverFind() { return Promise.resolve({ id: "srv-1", name: "Server", description: "", publisher: null, glyph: null, serverType, approvalStatus: "Published", status: "Active", revisions: [_ReadyRevision("revision-1", "tool-1")], credentialSchema: [], entitlementSummary: null, eraProbeStatus: McpEraProbeStates.NotRequired }); },
        "mcpServerInstall.upsert": function _upsert(arg: unknown) {
          const create = (arg as { create: Record<string, unknown> }).create;
          store.install ??= { mcpServerId: create.mcpServerId, principalId: create.principalId, connectionStatus: create.connectionStatus ?? "NeedsCredential", lastUsedAt: null };
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
		expect(_authorizationAuthority.constructedWith).toHaveBeenCalledTimes(1);
		expect(_authorizationAuthority.admitPrincipal).toHaveBeenCalledWith(expect.objectContaining({
			action: ProductAuthorizationActions.Install,
			resource: { kind: ProductAuthorizationResourceKinds.McpServer, id: "srv-1" },
			actorKind: "user",
			actorId: "principal-1",
			argumentsDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
		}));
    });

    it("installs a multi-user server as shared-key", async function _installShared()
    {
      const { prisma } = _statefulPrisma("MultiUser");
      const res = await request(_buildApp(prisma, { sub: "user-1" })).post("/api/v1/mcp/installed").send({ serverId: "srv-1" });

      expect(res.status).toBe(201);
      expect(res.body.connectionStatus).toBe("shared-key");
    });

	it("refuses a stale server identifier after the server becomes inactive", async function _RejectsInactiveServer()
	{
		const { prisma, spies } = _mockPrisma({
			"mcpServer.findFirst": function _FindServer() { return Promise.resolve({ id: "srv-1", name: "Server", description: "", publisher: null, glyph: null, serverType: "MultiUser", approvalStatus: "Published", status: "Degraded", revisions: [_ReadyRevision("revision-1", "tool-1")], credentialSchema: [], entitlementSummary: null, eraProbeStatus: McpEraProbeStates.Accepted }); },
		});

		const response = await request(_buildApp(prisma, { sub: "user-1" })).post("/api/v1/mcp/installed").send({ serverId: "srv-1" });

		expect(response.status).toBe(404);
		expect(spies["mcpServerInstall.upsert"]).toBeUndefined();
		expect(_authorizationAuthority.admitPrincipal).not.toHaveBeenCalled();
	});

	it("refuses installation when the central authority removes current access", async function _RejectsDeniedInstall()
	{
		_authorizationAuthority.admitPrincipal.mockResolvedValue({ outcome: "deny", reason: "no_matching_grant", grantIds: [], evidence: null });
		const { prisma, store } = _statefulPrisma("MultiUser");

		const response = await request(_buildApp(prisma, { sub: "user-1" })).post("/api/v1/mcp/installed").send({ serverId: "srv-1" });

		expect(response.status).toBe(404);
		expect(store.install).toBeNull();
	});

  });

  describe("user-scoping — a caller only sees / acts on their own installs", function _scoping()
  {
    it("scopes GET /installed to the calling user's id", async function _listScoped()
    {
      const { prisma, spies } = _mockPrisma({ "mcpServerInstall.findMany": function _f() { return Promise.resolve([]); } });
      await request(_buildApp(prisma, { sub: "caller-9" })).get("/api/v1/mcp/installed");

      expect(spies["mcpServerInstall.findMany"]).toHaveBeenCalledWith(expect.objectContaining({ where: { principalId: "principal-1" } }));
    });

    it("scopes DELETE /installed/:serverId to the calling user's id", async function _deleteScoped()
    {
      const { prisma, spies } = _mockPrisma({
        "mcpServerInstall.deleteMany": function _d() { return Promise.resolve({ count: 1 }); },
        "auditEntry.create": function _a() { return Promise.resolve({}); },
      });
      const res = await request(_buildApp(prisma, { sub: "caller-9" })).delete("/api/v1/mcp/installed/srv-1");

      expect(res.status).toBe(204);
      expect(spies["mcpServerInstall.deleteMany"]).toHaveBeenCalledWith({ where: { mcpServerId: "srv-1", principalId: "principal-1" } });
    });

  });
});
