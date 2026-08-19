import type { PrismaClient } from "@prisma/client";
import type { AuthenticationV1Api } from "@kubernetes/client-node";
import express from "express";
import type { Express } from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

import { AGENT_RUNTIME_PROJECTED_TOKEN_AUDIENCE, AGENT_RUNTIME_PROTOCOL_V1, MANAGED_AGENT_RUNTIME_PROJECTED_TOKEN_AUDIENCE, PublicHealthServiceNames, PublicHealthServiceStatuses, PublicHealthStatuses, RuntimeCandidateKinds, type RuntimeCandidate } from "@opencrane/contracts";
import { ___AuthMiddleware } from "@opencrane/backend/server/infra/auth";
import { _RateLimit } from "@opencrane/backend/server/infra/http";
import { _ReadProcessConfig } from "../app/config";

/** Keep identity-route tests independent from mounted ArtifactStore credentials. */
vi.mock("../infra/artifacts/artifact-upload.factory", function _MockArtifactUploadFactory()
{
	return {
		_CreateArtifactPreprocessOutputBroker: function _CreateArtifactPreprocessOutputBroker() { return {}; },
		_CreateConversationAssetOutputAuthority: function _CreateConversationAssetOutputAuthority() { return { reserve: vi.fn(), publish: vi.fn() }; },
		_CreateSkillAuthoringArtifactReader: function _CreateSkillAuthoringArtifactReader() { return {}; },
	};
});

/**
 * Build a minimal Express app that exercises OIDC/session authentication.
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
    res.json({
      status: PublicHealthStatuses.Ok,
      ready: true,
      services: {
        [PublicHealthServiceNames.Api]: PublicHealthServiceStatuses.Available,
        [PublicHealthServiceNames.Database]: PublicHealthServiceStatuses.Available,
        [PublicHealthServiceNames.Models]: PublicHealthServiceStatuses.Available,
        [PublicHealthServiceNames.Memory]: PublicHealthServiceStatuses.Available,
        [PublicHealthServiceNames.Files]: PublicHealthServiceStatuses.Available,
		[PublicHealthServiceNames.Channels]: PublicHealthServiceStatuses.Available,
        [PublicHealthServiceNames.Integrations]: PublicHealthServiceStatuses.Disabled,
      },
    });
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
  const { _RegisterInternalRoutes } = await import("../app/routes");
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
  _RegisterInternalRoutes(app, prisma, authApi, _ReadProcessConfig().runtime);
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
    kind: RuntimeCandidateKinds.Event,
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
    vi.stubEnv("MEMORY_GATEWAY_URL", "http://opencrane-memory-gateway.opencrane-silo.svc.cluster.local:8080");
    vi.stubEnv("MEMORY_GATEWAY_TOKEN_PATH", "/var/run/opencrane/memory-gateway/token");
		vi.stubEnv("OPENCRANE_MEMBERSHIP_MODE", "standalone");
		vi.stubEnv("OPENCRANE_MEMBERSHIP_MAX_STALENESS_MS", "86400000");
  });

  afterEach(function _RestoreEnvironment()
  {
    vi.unstubAllEnvs();
  });

  describe("auth middleware", () =>
  {
    it("fails closed when OIDC is not configured", async () =>
    {
      const app = _buildAuthApp();

      const res = await request(app).get("/api/test");
      expect(res.status).toBe(401);
    });

    it("healthz bypasses auth", async () =>
    {
      const app = _buildAuthApp();

      const res = await request(app).get("/healthz");
      expect(res.status).toBe(200);
      expect(res.body).toEqual(expect.objectContaining({
        status: PublicHealthStatuses.Ok,
        ready: true,
      }));
      expect(Object.keys(res.body.services).sort()).toEqual(["api", "channels", "database", "files", "integrations", "memory", "models"]);
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
      const { _RegisterInternalRoutes } = await import("../app/routes");
      const app = express();
      vi.stubEnv("AGENT_RUNTIME_PERSONAL_NAMESPACE", "");
      expect(function _MissingRuntimeNamespace() { _RegisterInternalRoutes(app, {} as PrismaClient, {} as AuthenticationV1Api, _ReadProcessConfig().runtime); }).toThrow(/different from POD_NAMESPACE/);

      vi.stubEnv("AGENT_RUNTIME_PERSONAL_NAMESPACE", "opencrane-silo");
      expect(function _SameRuntimeNamespace() { _RegisterInternalRoutes(app, {} as PrismaClient, {} as AuthenticationV1Api, _ReadProcessConfig().runtime); }).toThrow(/different from POD_NAMESPACE/);
    });

    it("rejects a reviewed token when Kubernetes omits the runtime audience", async function _RuntimeAudienceMismatch()
    {
      const app = await _BuildRuntimeCandidateApp("system:serviceaccount:opencrane-silo-runtime:agent-runtime-personal", ["opencrane"]);

      const response = await request(app).post("/api/internal/agent-runtime/candidates").set("authorization", "Bearer projected-token").send(_RuntimeCandidate());

      expect(response.status).toBe(401);
    });

		it("mounts the production channel resolver when the complete receiver contract is configured", async function _MountsChannelResolver()
		{
			const { _RegisterInternalRoutes } = await import("../app/routes");
			vi.stubEnv("CHANNEL_PROXY_SERVICE_ACCOUNT_NAME", "opencrane-channel-proxy");
			vi.stubEnv("CHANNEL_TARGET_TRUSTED_HOST", "acme.example.com");
			vi.stubEnv("CHANNEL_TARGET_SILO_ID", "silo-1");
			vi.stubEnv("CHANNEL_REPLAY_RECEIVER_ID", "conversation-replay-v1");
			vi.stubEnv("CHANNEL_REPLAY_ENDPOINT", "http://opencrane-server.opencrane-silo.svc.cluster.local:8081/api/internal/conversation-replay");
			const app = express();
			app.use(express.json());
			_RegisterInternalRoutes(app, {} as PrismaClient, {} as AuthenticationV1Api, _ReadProcessConfig().runtime);

			const response = await request(app).post("/api/internal/channel-targets:resolve").set("authorization", "Bearer projected-token").send({ action: "events.read", trustedHost: "acme.example.com", conversationId: "conversation-1" });

			expect(response.status).toBe(400);
			expect(response.body).toEqual({ error: "invalid_request" });
		});
  });
});
