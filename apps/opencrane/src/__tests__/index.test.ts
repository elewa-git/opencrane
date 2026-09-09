import express, { type Express } from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

import { PublicHealthServiceNames, PublicHealthServiceStatuses, PublicHealthStatuses } from "@opencrane/contracts";
import { ___AuthMiddleware } from "@opencrane/backend/server/infra/auth";
import { _RateLimit } from "@opencrane/backend/server/infra/http";

/** Keep identity-route tests independent from mounted ArtifactStore credentials. */
vi.mock("../infra/artifacts/artifact-upload.factory", function _MockArtifactUploadFactory()
{
	return {
		_CreateArtifactPreprocessOutputBroker: function _CreateArtifactPreprocessOutputBroker() { return {}; },
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
  app.use(___AuthMiddleware({ admit: vi.fn() }));

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
      },
    });
  });

  app.get("/api/test", function _test(req, res)
  {
    res.json({ ok: true });
  });

  return app;
}

describe("Control Plane", () =>
{
  beforeEach(function _RuntimeNamespaceBoundary()
  {
	vi.stubEnv("DATABASE_URL", "postgresql://opencrane:test@localhost:5432/opencrane");
    vi.stubEnv("POD_NAMESPACE", "opencrane-silo");
    vi.stubEnv("MEMORY_GATEWAY_URL", "http://opencrane-memory-gateway.opencrane-silo.svc.cluster.local:8080");
		vi.stubEnv("MEMORY_GATEWAY_TOKEN_PATH", "/var/run/opencrane/memory-gateway/token");
		vi.stubEnv("OPENCRANE_HISTORY_STORE_ENDPOINT", "opencrane-kurrentdb.opencrane-silo.svc:2113");
		vi.stubEnv("OPENCRANE_HISTORY_STORE_CA_CERTIFICATE_PATH", "/var/run/opencrane/history-store/ca.crt");
		vi.stubEnv("OPENCRANE_HISTORY_STORE_USERNAME_PATH", "/var/run/opencrane/history-store/username");
		vi.stubEnv("OPENCRANE_HISTORY_STORE_PASSWORD_PATH", "/var/run/opencrane/history-store/password");
		vi.stubEnv("CONVERSATION_PRIVATE_PAYLOAD_KEYRING_PATH", "/var/run/opencrane/conversation-payload/keyring.json");
		vi.stubEnv("OPENCRANE_MEMBERSHIP_MODE", "standalone");
		vi.stubEnv("OPENCRANE_OCI_REGISTRY_BASE_URL", "https://registry.example.test");
		vi.stubEnv("OPENCRANE_OCI_REGISTRY_REPOSITORY", "opencrane/mcp-images");
		vi.stubEnv("OPENCRANE_SILO_ID", "opencrane-silo");
		vi.stubEnv("OPENCRANE_MEMBERSHIP_MAX_STALENESS_MS", "86400000");
		vi.stubEnv("SKILL_AUTHORING_NAMESPACE", "opencrane-skill-authoring");
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
      expect(Object.keys(res.body.services).sort()).toEqual(["api", "database", "files", "memory", "models"]);
    });

  });
});
