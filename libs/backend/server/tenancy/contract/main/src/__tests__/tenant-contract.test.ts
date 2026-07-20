import express from "express";
import type { Express } from "express";
import * as k8s from "@kubernetes/client-node";
import type { PrismaClient } from "@prisma/client";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { _RegisterInternalTenantContract } from "../index.js";
import { compileForPrincipals } from "@opencrane/backend/server/iam/grants";

// Mock the grant compiler at the module boundary so tests can drive Allow/Deny
// decisions directly without constructing grant rows. Default: no entitlements,
// which keeps every existing test's empty-contract expectations intact.
vi.mock("@opencrane/backend/server/iam/grants", async function _mockGrants(importOriginal)
{
  const actual = await importOriginal<typeof import("@opencrane/backend/server/iam/grants")>();
  return { ...actual, compile: vi.fn().mockResolvedValue([]), compileForPrincipals: vi.fn().mockResolvedValue([]) };
});

/** Build a mock AuthenticationV1Api that returns a controlled TokenReview response. */
function _buildAuthApi(opts: {
  authenticated: boolean;
  subject?: string;
  audiences?: string[];
}): k8s.AuthenticationV1Api
{
  const status: k8s.V1TokenReviewStatus = {
    authenticated: opts.authenticated,
    audiences: opts.audiences ?? ["opencrane-server"],
    user: opts.subject ? { username: opts.subject } : undefined,
  };
  return {
    createTokenReview: vi.fn().mockResolvedValue({ status } as k8s.V1TokenReview),
  } as unknown as k8s.AuthenticationV1Api;
}

/** Build a mock Prisma client for contract endpoint tests. */
function _buildPrismaStub(overrides: {
  tenant?: { name: string; team: string | null; awarenessWave?: string | null; subject?: string | null } | null;
  rollout?: Record<string, unknown> | null;
} = {}): PrismaClient
{
  const tenant = "tenant" in overrides ? overrides.tenant : { name: "team-alpha", team: null };
  const rollout = "rollout" in overrides ? overrides.rollout : null;

  return {
    tenant: {
      findUnique: vi.fn().mockResolvedValue(tenant),
    },
    grant: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    group: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    tenantDatasetMembership: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    mcpServer: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    tenantWorkspaceDoc: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    awarenessRollout: {
      findUnique: vi.fn().mockResolvedValue(rollout),
    },
  } as unknown as PrismaClient;
}

/** Build a test Express app containing only the internal contract router. */
function _buildApp(prisma: PrismaClient, authApi: k8s.AuthenticationV1Api): Express
{
  const app = express();
  app.use(express.json());
  app.use("/api/internal/contract", _RegisterInternalTenantContract(prisma, authApi));
  return app;
}

/** Shared valid auth API for happy-path tests — authenticates as tenant `team-alpha`. */
const _validAuthApi = _buildAuthApi({
  authenticated: true,
  subject: "system:serviceaccount:opencrane:team-alpha",
  audiences: ["opencrane-server"],
});

describe("_RegisterInternalTenantContract GET /:name", () =>
{
  it("returns 401 when no Authorization header is present", async () =>
  {
    const prisma = _buildPrismaStub();
    const app = _buildApp(prisma, _validAuthApi);

    const res = await request(app).get("/api/internal/contract/team-alpha");

    expect(res.status).toBe(401);
  });

  it("returns 401 when the token is not authenticated", async () =>
  {
    const authApi = _buildAuthApi({ authenticated: false });
    const prisma = _buildPrismaStub();
    const app = _buildApp(prisma, authApi);

    const res = await request(app)
      .get("/api/internal/contract/team-alpha")
      .set("Authorization", "Bearer invalid-token");

    expect(res.status).toBe(401);
  });

  it("returns 403 when the authenticated tenant does not match the requested tenant", async () =>
  {
    const prisma = _buildPrismaStub({ tenant: { name: "team-beta", team: null } });
    const app = _buildApp(prisma, _validAuthApi);

    // `_validAuthApi` authenticates as `team-alpha`, but we request `team-beta`.
    const res = await request(app)
      .get("/api/internal/contract/team-beta")
      .set("Authorization", "Bearer valid-token-for-team-alpha");

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("FORBIDDEN");
  });

  it("returns 404 when the authenticated tenant does not exist in the database", async () =>
  {
    const prisma = _buildPrismaStub({ tenant: null });
    const app = _buildApp(prisma, _validAuthApi);

    const res = await request(app)
      .get("/api/internal/contract/team-alpha")
      .set("Authorization", "Bearer valid");

    expect(res.status).toBe(404);
    expect(res.body.code).toBe("NOT_FOUND");
  });

  it("returns a contract with the expected shape for a known tenant", async () =>
  {
    const prisma = _buildPrismaStub({ tenant: { name: "team-alpha", team: "alpha" } });
    const app = _buildApp(prisma, _validAuthApi);

    const res = await request(app)
      .get("/api/internal/contract/team-alpha")
      .set("Authorization", "Bearer valid");

    expect(res.status).toBe(200);
    expect(res.body.version).toBe("opencrane-runtime/v1alpha1");
    expect(res.body.tenant.name).toBe("team-alpha");
    expect(res.body.tenant.team).toBe("alpha");
    expect(res.body.policy.mcpServers).toBeDefined();
    expect(res.body.skills).toBeUndefined();
    // P4B.3: awareness contract version delivered on every pull. With no rollout
    // defined and an unassigned tenant, it resolves to the pinned version, no shadow,
    // and the final (most-conservative) wave.
    expect(typeof res.body.awareness.contractVersion).toBe("string");
    expect(res.body.awareness.contractVersion.length).toBeGreaterThan(0);
    expect(res.body.awareness).toMatchObject({ shadow: false, wave: "org" });
  });

  it("delivers the rollout target version for a tenant in a promoted wave (P4B.3)", async () =>
  {
    const prisma = _buildPrismaStub({
      tenant: { name: "team-alpha", team: null, awarenessWave: "personal" },
      rollout: {
        id: "default", targetVersion: "awareness/v2alpha1", stableVersion: "awareness/v1alpha1",
        waves: ["personal", "project", "department", "org"], promotedWaves: ["personal"], shadowMode: false,
      },
    });
    const app = _buildApp(prisma, _validAuthApi);

    const res = await request(app)
      .get("/api/internal/contract/team-alpha")
      .set("Authorization", "Bearer valid");

    expect(res.status).toBe(200);
    // The tenant's "personal" wave is promoted → it runs the target version.
    expect(res.body.awareness).toMatchObject({ contractVersion: "awareness/v2alpha1", shadow: false, wave: "personal" });
  });

  it("includes MCP server policy arrays in the response", async () =>
  {
    const prisma = _buildPrismaStub({ tenant: { name: "team-alpha", team: null } });
    const app = _buildApp(prisma, _validAuthApi);

    const res = await request(app)
      .get("/api/internal/contract/team-alpha")
      .set("Authorization", "Bearer valid");

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.policy.mcpServers.allow)).toBe(true);
    expect(Array.isArray(res.body.policy.mcpServers.deny)).toBe(true);
  });

  it("includes a contract-derived TOOLS.md workspace doc", async () =>
  {
    const prisma = _buildPrismaStub({ tenant: { name: "team-alpha", team: null } });
    const app = _buildApp(prisma, _validAuthApi);

    const res = await request(app)
      .get("/api/internal/contract/team-alpha")
      .set("Authorization", "Bearer valid");

    expect(res.status).toBe(200);
    const tools = res.body.workspace?.["TOOLS.md"];
    expect(typeof tools).toBe("string");
    expect(tools).toContain("# TOOLS");
    // With no entitlements the section renders an explicit "none" note rather than vanishing.
    expect(tools).toContain("No MCP servers are currently entitled.");
  });

  it("compiles the contract over the tenant's principal SET {name, subject} when bound (S4 inheritance)", async () =>
  {
    vi.mocked(compileForPrincipals).mockClear();
    const prisma = _buildPrismaStub({ tenant: { name: "team-alpha", team: null, subject: "user-sub" } });
    const app = _buildApp(prisma, _validAuthApi);

    const res = await request(app)
      .get("/api/internal/contract/team-alpha")
      .set("Authorization", "Bearer valid");

    expect(res.status).toBe(200);
    // The route must pass BOTH the tenant name and its bound subject so the openclaw Tenant
    // inherits the user's grants — guards the principal-set construction (a typo collapsing
    // it to tenant-only would otherwise pass every other test).
    expect(vi.mocked(compileForPrincipals)).toHaveBeenCalledWith(["team-alpha", "user-sub"], expect.anything(), expect.anything());
    // Never called with the tenant alone when a subject is bound.
    expect(vi.mocked(compileForPrincipals)).not.toHaveBeenCalledWith(["team-alpha"], expect.anything(), expect.anything());
  });

  it("collapses to the tenant principal alone for a legacy/unbound tenant (subject null)", async () =>
  {
    vi.mocked(compileForPrincipals).mockClear();
    const prisma = _buildPrismaStub({ tenant: { name: "team-alpha", team: null, subject: null } });
    const app = _buildApp(prisma, _validAuthApi);

    const res = await request(app)
      .get("/api/internal/contract/team-alpha")
      .set("Authorization", "Bearer valid");

    expect(res.status).toBe(200);
    expect(vi.mocked(compileForPrincipals)).toHaveBeenCalledWith(["team-alpha"], expect.anything(), expect.anything());
  });
});
