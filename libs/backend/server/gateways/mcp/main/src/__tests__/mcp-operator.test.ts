import { createHash } from "node:crypto";

import express from "express";
import type { Express } from "express";
import type { PrismaClient } from "@prisma/client";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@opencrane/backend/server/iam/authorization", async function _mockAuthorization()
{
  const actual = await vi.importActual("@opencrane/backend/server/iam/authorization");
  return { ...actual, __ResolvePrincipalAuthorization: vi.fn().mockResolvedValue({ outcome: "allow", reason: "winning_allow", grantIds: ["grant-1"] }) };
});

import { __ResolvePrincipalAuthorization } from "@opencrane/backend/server/iam/authorization";
import type { AuthenticatedPrincipalDirectory } from "@opencrane/backend/server/iam/identity";
import { AuthorizationDecisionOutcomes } from "@opencrane/models/authorization";
import { mcpOperatorRouter } from "../routes/mcp-operator";
import { PrismaMcpOperatorUnitOfWork } from "../core/prisma-mcp-operator-unit-of-work";
import { McpEraProbeStates } from "../era-probe/mcp-era-probe.types";
import type { McpEraProbeWorkflow } from "../era-probe/mcp-era-probe.types";
import type { OciImageLayoutArtifactResolver } from "../oci-image-validation/oci-image-validation-submission.types";
import type { OciImageValidationWorkflow } from "../oci-image-validation/oci-image-validation.types";

/**
 * Covers the MCP operator routes: the organization-admin gate, published entries filtered by
 * authorization, install states selected by server type, and install scoping to the local Principal.
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
            else if (key === "capabilityCatalogRevision.findUnique")
              spies[key] = vi.fn().mockResolvedValue({ digest: "sha256:b437ba0e9642ea867d58011ca828aa863b0e1a21528f91d567bccec74c71bff6", capabilities: [{ id: "mcp-server:use", actions: ["use"] }] });
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

describe("mcp-operator router", function _suite()
{
  const _saved: Record<string, string | undefined> = {};

  /** Snapshots then clears the authentication environment so each case configures its own auth setup. */
  beforeEach(function _clearEnv()
  {
    vi.mocked(__ResolvePrincipalAuthorization).mockReset().mockResolvedValue({ outcome: AuthorizationDecisionOutcomes.Allow, reason: "winning_allow", grantIds: ["grant-1"] });
    for (const key of _AUTH_ENV) { _saved[key] = process.env[key]; delete process.env[key]; }
  });

  /** Restore the auth env captured in `beforeEach` so cases stay isolated. */
  afterEach(function _restoreEnv()
  {
    for (const key of _AUTH_ENV) { if (_saved[key] === undefined)
    { delete process.env[key]; } else { process.env[key] = _saved[key]; } }
  });

  describe("org-admin gate on governance endpoints", function _gate()
  {
    it("denies GET /servers for a non-admin session", async function _denyList()
    {
      _enableOidc();
      const { prisma, spies } = _mockPrisma();
      const res = await request(_buildApp(prisma, { sub: "u1", isOrgAdmin: false })).get("/api/v1/mcp/servers");

      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ code: "FORBIDDEN_NOT_ORG_ADMIN" });
      expect(spies["mcpServer.findMany"]).toBeUndefined();
    });

    it("denies PUT /servers/:id/access for a non-admin session", async function _denyAccess()
    {
      _enableOidc();
      const { prisma, spies } = _mockPrisma();
      const res = await request(_buildApp(prisma, { sub: "u1", isOrgAdmin: false }))
        .put("/api/v1/mcp/servers/srv-1/access").send({ everyoneInOrg: true, groups: [], users: [] });

      expect(res.status).toBe(403);
      expect(spies["mcpServerAccessPolicy.upsert"]).toBeUndefined();
    });

    it("denies GET /directory for a non-admin session", async function _denyDirectory()
    {
      _enableOidc();
      const { prisma } = _mockPrisma();
      const res = await request(_buildApp(prisma, { sub: "u1", isOrgAdmin: false })).get("/api/v1/mcp/directory");

      expect(res.status).toBe(403);
    });

    it("rejects non-string access-policy identifiers before persistence", async function _RejectsMalformedAccessPolicy()
    {
      _enableOidc();
      const { prisma } = _mockPrisma();
      const res = await request(_buildApp(prisma, { sub: "admin", isOrgAdmin: true }))
        .put("/api/v1/mcp/servers/srv-1/access").send({ groupIds: [42], principalIds: [] });

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ code: "VALIDATION_ERROR" });
    });

    it("lets an org-admin session through GET /servers to the handler", async function _allowList()
    {
      _enableOidc();
      const { prisma, spies } = _mockPrisma();
      const res = await request(_buildApp(prisma, { sub: "admin", isOrgAdmin: true })).get("/api/v1/mcp/servers");

      expect(res.status).not.toBe(403);
      expect(spies["mcpServer.findMany"]).toHaveBeenCalled();
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
      const server = { id: "srv-1", name: "Server", description: "", publisher: null, glyph: null, serverType: "SingleUser", approvalStatus: "Published", credentialSchema: [], entitlementSummary: null, eraProbeStatus: McpEraProbeStates.Accepted };
      const { prisma, spies } = _mockPrisma({
        "mcpServer.updateMany": function _Update() { return Promise.resolve({ count: 1 }); },
        "mcpServer.findFirst": function _Find() { return Promise.resolve(server); },
        "auditEntry.create": function _Audit() { return Promise.resolve({}); },
      });

      const response = await request(_buildApp(prisma, { sub: "admin", isOrgAdmin: true })).post("/api/v1/mcp/servers/srv-1/enabled").send({ enabled: true });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ id: "srv-1", approvalStatus: "published" });
      expect(spies["mcpServer.updateMany"]).toHaveBeenCalledWith({ where: { id: "srv-1", siloId: "silo-1", eraProbeStatus: { in: ["Accepted", "NotRequired"] }, approvalStatus: "Disabled" }, data: { approvalStatus: "Published" } });
	  expect(spies["auditEntry.create"]).toHaveBeenCalledWith({ data: expect.objectContaining({ metadata: { siloId: "silo-1", actorPrincipalId: "principal-1" } }) });
    });

	it("records the authenticated administrator with an access-policy change", async function _AuditsAccessPolicyActor()
	{
		_enableOidc();
		const server = { id: "srv-1", name: "Server", description: "", publisher: null, glyph: null, serverType: "SingleUser", approvalStatus: "Published", credentialSchema: [], entitlementSummary: null, eraProbeStatus: McpEraProbeStates.Accepted };
		const { prisma, spies } = _mockPrisma({
			"mcpServer.findFirst": function _Find() { return Promise.resolve(server); },
			"authorizationGrant.findMany": function _FindGrants() { return Promise.resolve([]); },
			"auditEntry.create": function _Audit() { return Promise.resolve({}); },
		});

		const response = await request(_buildApp(prisma, { sub: "admin", isOrgAdmin: true })).put("/api/v1/mcp/servers/srv-1/access").send({ groupIds: [], principalIds: [] });

		expect(response.status).toBe(200);
		expect(spies["auditEntry.create"]).toHaveBeenCalledWith({ data: expect.objectContaining({ metadata: { siloId: "silo-1", actorPrincipalId: "principal-1" } }) });
	});

    it("fails closed when no session is established", async function _denyUnauthenticated()
    {
      const { prisma } = _mockPrisma();
      const res = await request(_buildApp(prisma)).get("/api/v1/mcp/servers");

      expect(res.status).toBe(403);
    });
  });

  describe("GET /catalog — published + entitled filtering", function _catalog()
  {
    /** Two published servers filtered by the generic authorization decision. */
    const _servers = [
      { id: "srv-open", name: "Open", description: "", publisher: null, glyph: null, serverType: "MultiUser", approvalStatus: "Published", credentialSchema: [], entitlementSummary: null, eraProbeStatus: McpEraProbeStates.NotRequired, createdAt: new Date() },
      { id: "srv-closed", name: "Closed", description: "", publisher: null, glyph: null, serverType: "SingleUser", approvalStatus: "Published", credentialSchema: [], entitlementSummary: null, eraProbeStatus: McpEraProbeStates.NotRequired, createdAt: new Date() },
    ];

    it("returns only the servers the caller is entitled to", async function _filters()
    {
      _enableOidc();
      vi.mocked(__ResolvePrincipalAuthorization).mockImplementation(async function _decide(_repository, command) { return command.resource.id === "srv-open" ? { outcome: AuthorizationDecisionOutcomes.Allow, reason: "winning_allow", grantIds: ["grant-open"] } : { outcome: AuthorizationDecisionOutcomes.Deny, reason: "no_matching_grant", grantIds: [] }; });
      const { prisma } = _mockPrisma({ "mcpServer.findMany": function _findMany() { return Promise.resolve(_servers); } });
      const res = await request(_buildApp(prisma, { sub: "user-1", groups: [], isOrgAdmin: false })).get("/api/v1/mcp/catalog");

      expect(res.status).toBe(200);
      expect(res.body.map(function _id(s: { id: string }) { return s.id; })).toEqual(["srv-open"]);
      expect(res.body[0]).toMatchObject({ id: "srv-open", type: "multi-user", approvalStatus: "published" });
    });

    it("does not pass raw OIDC group claims into authorization", async function _group()
    {
      _enableOidc();
      const { prisma } = _mockPrisma({ "mcpServer.findMany": function _findMany() { return Promise.resolve(_servers); } });
      const res = await request(_buildApp(prisma, { sub: "user-2", groups: ["group:untrusted"], isOrgAdmin: false })).get("/api/v1/mcp/catalog");

      expect(res.status).toBe(200);
      expect(res.body.map(function _id(s: { id: string }) { return s.id; }).sort()).toEqual(["srv-closed", "srv-open"]);
      expect(vi.mocked(__ResolvePrincipalAuthorization).mock.calls.every(function _noClaims(call) { return !("groups" in call[1]); })).toBe(true);
    });
  });

  describe("POST /servers — remote registration", function _Registration()
  {
    it("saves the draft and admits its workflow through the same database transaction", async function _RegistersAtomically()
    {
      _enableOidc();
      const workflow = _EraProbeWorkflow();
      const server = { id: "srv-new", name: "Example MCP", description: "Public tools", publisher: null, glyph: null, serverType: "SingleUser", approvalStatus: "PendingReview", credentialSchema: [], entitlementSummary: null, endpoint: "https://mcp.example.test/", registrationKeyDigest: `sha256:${"a".repeat(64)}`, registrationDigest: `sha256:${"b".repeat(64)}`, eraProbeStatus: "Pending", eraProtocolVersion: null, eraProbeEvidenceDigest: null, eraProbeFailureCode: null, eraProbeAttempts: 0 };
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
	  expect(spies["auditEntry.create"]).toHaveBeenCalledWith({ data: expect.objectContaining({ metadata: { siloId: "silo-1", actorPrincipalId: "principal-1" } }) });
      const [transaction, task] = vi.mocked(workflow.admit).mock.calls[0] as Parameters<McpEraProbeWorkflow["admit"]>;
      expect(transaction.client).toBe(prisma);
      expect(task).toEqual(expect.objectContaining({ siloId: "silo-1", serverId: "srv-new" }));
    });

		it("returns the current protocol state when an accepted registration is replayed", async function _ReplaysAcceptedRegistration()
		{
			_enableOidc();
			const workflow = _EraProbeWorkflow();
			const registrationDigest = `sha256:${createHash("sha256").update(JSON.stringify(["Example MCP", "Public tools", "https://mcp.example.test/"])).digest("hex")}`;
			const server = { id: "srv-new", name: "Example MCP", description: "Public tools", publisher: null, glyph: null, serverType: "SingleUser", approvalStatus: "PendingReview", credentialSchema: [], entitlementSummary: null, endpoint: "https://mcp.example.test/", registrationKeyDigest: `sha256:${"a".repeat(64)}`, registrationDigest, eraProbeStatus: "Accepted", eraProtocolVersion: "2026-07-28", eraProbeEvidenceDigest: `sha256:${"c".repeat(64)}`, eraProbeFailureCode: null, eraProbeAttempts: 1 };
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
        "mcpServer.findFirst": function _serverFind() { return Promise.resolve({ id: "srv-1", name: "Server", description: "", publisher: null, glyph: null, serverType, approvalStatus: "Published", credentialSchema: [], entitlementSummary: null, eraProbeStatus: McpEraProbeStates.NotRequired }); },
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
    });

    it("installs a multi-user server as shared-key", async function _installShared()
    {
      const { prisma } = _statefulPrisma("MultiUser");
      const res = await request(_buildApp(prisma, { sub: "user-1" })).post("/api/v1/mcp/installed").send({ serverId: "srv-1" });

      expect(res.status).toBe(201);
      expect(res.body.connectionStatus).toBe("shared-key");
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
