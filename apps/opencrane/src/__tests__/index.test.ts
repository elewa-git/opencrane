import type { PrismaClient } from "@prisma/client";
import type { AuthenticationV1Api } from "@kubernetes/client-node";
import express from "express";
import type { Express } from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

import { AGENT_RUNTIME_PROJECTED_TOKEN_AUDIENCE, AGENT_RUNTIME_PROTOCOL_V1, MANAGED_AGENT_RUNTIME_PROJECTED_TOKEN_AUDIENCE, type RuntimeCandidate } from "@opencrane/contracts";
import { ___AuthMiddleware } from "@opencrane/server/_infra/auth";
import { _CheckDbHealth, _RateLimit } from "@opencrane/server/_infra/http";

/**
 * Build a minimal Express app with a mocked database health handler.
 * @param dbHealthy - Whether the mock DB query should succeed
 * @returns An Express app wired for health-check testing
 */
function _buildHealthApp(dbHealthy: boolean): Express
{
  const prisma = {
    $queryRaw: dbHealthy ? vi.fn().mockResolvedValue([{ 1: 1 }]) : vi.fn().mockRejectedValue(new Error("db unavailable")),
  } as unknown as PrismaClient;

  const app = express();
  app.use(express.json());
  app.get("/healthz", _CheckDbHealth(prisma));

  return app;
}

/**
 * Build a minimal Express app that exercises OIDC/session or development auth.
 * @returns An Express app wired for auth testing
 */
function _buildAuthApp(): Express
{
  const app = express();
  app.use(express.json());
  // Mirror production middleware order: the per-IP limiter is mounted before auth + routes.
  app.use(_RateLimit());
  app.use(___AuthMiddleware());

  app.get("/healthz", function _healthz(req, res)
  {
    res.json({ status: "ok", db: true });
  });

  app.get("/api/test", function _test(req, res)
  {
    res.json({ ok: true });
  });

  return app;
}

/** Build the internal runtime candidate route around one mocked TokenReview identity. */
async function _BuildRuntimeCandidateApp(username: string, audiences: string[] = [AGENT_RUNTIME_PROJECTED_TOKEN_AUDIENCE]): Promise<Express>
{
  const { _RegisterInternalRoutes } = await import("../app/routes.js");
  // The real Prisma dispatch authority runs inside a transaction and loads the live assignment for
  // the reviewed Pod. Returning no assignment lets an authenticated runtime reach the authority and
  // receive its real fail-closed candidate denial instead of a hardcoded stub reason.
  const prisma = {
    $transaction: vi.fn(async function _transaction(run: (tx: unknown) => Promise<unknown>)
    {
      return run({
        $queryRaw: vi.fn().mockResolvedValue([]),
        workloadAssignment: { findUnique: vi.fn().mockResolvedValue(null) },
      });
    }),
  } as unknown as PrismaClient;
  const authApi = {
    createTokenReview: vi.fn().mockResolvedValue({
      status: {
        authenticated: true,
        audiences,
        user: {
          username,
          extra: { "authentication.kubernetes.io/pod-uid": ["11111111-1111-4111-8111-111111111111"] },
        },
      },
    }),
  } as unknown as AuthenticationV1Api;
  const app = express();
  app.use(express.json());
  _RegisterInternalRoutes(app, prisma, authApi);
  return app;
}

/** Create a syntactically valid runtime event candidate for identity-bound route tests. */
function _RuntimeCandidate(): RuntimeCandidate
{
  return {
    protocolVersion: AGENT_RUNTIME_PROTOCOL_V1,
    runtimeInstanceId: "runtime-1",
    commandId: "command-1",
    candidateId: "candidate-1",
    runId: "run-1",
    attempt: 1,
    fence: 1,
    kind: "event",
    eventType: "run.started",
    payload: {},
  };
}

describe("Control Plane", () =>
{
  beforeEach(function _RuntimeNamespaceBoundary()
  {
    vi.stubEnv("POD_NAMESPACE", "opencrane-silo");
    vi.stubEnv("AGENT_RUNTIME_PERSONAL_NAMESPACE", "opencrane-silo-runtime");
    vi.stubEnv("AGENT_RUNTIME_MANAGED_NAMESPACE", "opencrane-silo-managed-runtime");
  });

  afterEach(function _RestoreEnvironment()
  {
    vi.unstubAllEnvs();
  });

  it("healthz endpoint returns ok", async () =>
  {
    const app = _buildHealthApp(true);
    const res = await request(app).get("/healthz");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok", db: true });
  });

  it("healthz endpoint returns degraded when DB is unavailable", async () =>
  {
    const app = _buildHealthApp(false);
    const res = await request(app).get("/healthz");

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: "degraded", db: false });
  });

  describe("auth middleware", () =>
  {
    it("allows all requests when OIDC is not configured (development mode)", async () =>
    {
      const app = _buildAuthApp();

      const res = await request(app).get("/api/test");
      expect(res.status).toBe(200);
    });

    it("healthz bypasses auth", async () =>
    {
      const app = _buildAuthApp();

      const res = await request(app).get("/healthz");
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("ok");
    });

    it("serves /api/internal tokenless on the internal listener, and never mounts a session gate there", async () =>
    {
      // The internal API lives on its OWN listener (createInternalApp) with NO session/token
      // auth — the NetworkPolicy-only routes authenticate at the network layer, kept off the
      // public ingress-facing listener so they can't be reached from the internet. We mirror
      // createInternalApp's wiring here (importing ../index.js would boot the real servers) and
      // assert /api/internal is reachable tokenless AND that a would-be auth gate never runs.
      const { _RegisterInternalRoutes } = await import("../app/routes.js");

      const prisma = {
        tenant: { findUnique: vi.fn().mockResolvedValue(null) },
        modelDefinition: { findMany: vi.fn().mockResolvedValue([]) },
        modelRoutingDefault: { findFirst: vi.fn().mockResolvedValue(null) },
      } as unknown as PrismaClient;

      let gateRan = false;
      const app = express();
      app.use(express.json());
      _RegisterInternalRoutes(app, prisma, {} as never);
      // A stand-in for any auth middleware: on the internal listener it must NEVER run for
      // /api/internal (those routes handle the request first and end it).
      app.use(function _wouldBeGate(req, res, next) { gateRan = true; next(); });

      const internal = await request(app).get("/api/internal/tenant-models/some-tenant");
      expect(internal.status).toBe(200);
      expect(internal.body).toEqual({ models: [], defaultModel: null });
      expect(gateRan).toBe(false);
    });

    it("accepts only the bounded runtime-profile ServiceAccount naming contract", async function _RuntimeServiceAccountIdentity()
    {
      const acceptedApp = await _BuildRuntimeCandidateApp("system:serviceaccount:opencrane-silo-runtime:agent-runtime-personal");
      const rejectedApp = await _BuildRuntimeCandidateApp("system:serviceaccount:opencrane-silo:agent-runtime-personal");

      const accepted = await request(acceptedApp).post("/api/internal/agent-runtime/candidates").set("authorization", "Bearer projected-token").send(_RuntimeCandidate());
      const rejected = await request(rejectedApp).post("/api/internal/agent-runtime/candidates").set("authorization", "Bearer projected-token").send(_RuntimeCandidate());

      // A reviewed runtime SA reaches the real dispatch authority, which fails closed with a
      // contract reason (no live assignment for this Pod) rather than a stubbed placeholder string.
      expect(accepted.status).toBe(409);
      expect(accepted.body).toEqual({ accepted: false, reason: "unknown_workload" });
      // A subject outside the bounded runtime namespace/SA grammar never reaches the authority.
      expect(rejected.status).toBe(401);
    });

    it("accepts the managed audience only in the dedicated managed runtime plane", async function _ManagedRuntimeServiceAccountIdentity()
    {
      const acceptedApp = await _BuildRuntimeCandidateApp("system:serviceaccount:opencrane-silo-managed-runtime:managed-agent-runtime-default", [MANAGED_AGENT_RUNTIME_PROJECTED_TOKEN_AUDIENCE]);
      const crossedApp = await _BuildRuntimeCandidateApp("system:serviceaccount:opencrane-silo-runtime:managed-agent-runtime-default", [MANAGED_AGENT_RUNTIME_PROJECTED_TOKEN_AUDIENCE]);

      const accepted = await request(acceptedApp).post("/api/internal/agent-runtime/candidates").set("authorization", "Bearer projected-token").send(_RuntimeCandidate());
      const crossed = await request(crossedApp).post("/api/internal/agent-runtime/candidates").set("authorization", "Bearer projected-token").send(_RuntimeCandidate());

      expect(accepted.status).toBe(409);
      expect(accepted.body).toEqual({ accepted: false, reason: "unknown_workload" });
      expect(crossed.status).toBe(401);
    });

    it("requires one explicit runtime namespace separate from the server", async function _RuntimeNamespaceSeparation()
    {
      const { _RegisterInternalRoutes } = await import("../app/routes.js");
      const app = express();
      vi.stubEnv("AGENT_RUNTIME_PERSONAL_NAMESPACE", "");
      expect(function _MissingRuntimeNamespace() { _RegisterInternalRoutes(app, {} as PrismaClient, {} as AuthenticationV1Api); }).toThrow(/different from POD_NAMESPACE/);

      vi.stubEnv("AGENT_RUNTIME_PERSONAL_NAMESPACE", "opencrane-silo");
      expect(function _SameRuntimeNamespace() { _RegisterInternalRoutes(app, {} as PrismaClient, {} as AuthenticationV1Api); }).toThrow(/different from POD_NAMESPACE/);
    });

    it("rejects a reviewed token when Kubernetes omits the runtime audience", async function _RuntimeAudienceMismatch()
    {
      const app = await _BuildRuntimeCandidateApp("system:serviceaccount:opencrane-silo-runtime:agent-runtime-personal", ["opencrane"]);

      const response = await request(app).post("/api/internal/agent-runtime/candidates").set("authorization", "Bearer projected-token").send(_RuntimeCandidate());

      expect(response.status).toBe(401);
    });
  });
});
