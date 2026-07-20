import type * as k8s from "@kubernetes/client-node";
import express from "express";
import type { Express } from "express";
import type { PrismaClient } from "@prisma/client";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { aiBudgetRouter } from "../routes/ai-budget.js";

/** Build a minimal app containing only the AI budget route. */
function _buildAiBudgetApp(coreApi: k8s.CoreV1Api, prisma: PrismaClient): Express
{
  const app = express();
  app.use(express.json());
  app.use("/api/ai-budget", aiBudgetRouter(coreApi, prisma));
  return app;
}

describe("aiBudgetRouter", () =>
{
  const originalEndpoint = process.env.LITELLM_ENDPOINT;
  const originalMasterKey = process.env.LITELLM_MASTER_KEY;
  const originalPathTemplate = process.env.LITELLM_SPEND_PATH_TEMPLATE;

  beforeEach(() =>
  {
    process.env.LITELLM_ENDPOINT = "http://litellm:4000";
    process.env.LITELLM_MASTER_KEY = "master-key";
    process.env.LITELLM_SPEND_PATH_TEMPLATE = "/spend/tenant/{tenant}";
  });

  afterEach(() =>
  {
    if (originalEndpoint !== undefined)
    {
      process.env.LITELLM_ENDPOINT = originalEndpoint;
    }
    else
    {
      delete process.env.LITELLM_ENDPOINT;
    }

    if (originalMasterKey !== undefined)
    {
      process.env.LITELLM_MASTER_KEY = originalMasterKey;
    }
    else
    {
      delete process.env.LITELLM_MASTER_KEY;
    }

    if (originalPathTemplate !== undefined)
    {
      process.env.LITELLM_SPEND_PATH_TEMPLATE = originalPathTemplate;
    }
    else
    {
      delete process.env.LITELLM_SPEND_PATH_TEMPLATE;
    }

    vi.restoreAllMocks();
  });

  it("returns 404 when tenant does not exist for spend endpoint", async () =>
  {
    const prisma = {
      tenant: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
    } as unknown as PrismaClient;

    const coreApi = {} as k8s.CoreV1Api;
    const app = _buildAiBudgetApp(coreApi, prisma);
    const res = await request(app).get("/api/ai-budget/missing-tenant/spend");

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Tenant not found" });
  });

  it("returns normalized spend response from LiteLLM payload", async () =>
  {
    const prisma = {
      tenant: {
        findUnique: vi.fn().mockResolvedValue({ name: "jente" }),
      },
      tokenUsageSnapshot: {
        findUnique: vi.fn(),
      },
      accountBudgetSetting: {
        findUnique: vi.fn(),
      },
      globalBudgetSetting: {
        findUnique: vi.fn(),
      },
    } as unknown as PrismaClient;

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async function _json()
      {
        return {
          total_cost: 12.5,
          max_budget: 100,
          top_models: [
            { model: "gpt-4.1", total_cost: 10.2, requests: 20 },
            { model: "gpt-4.1-mini", total_cost: 2.3, requests: 45 },
          ],
        };
      },
    }));

    const coreApi = {} as k8s.CoreV1Api;
    const app = _buildAiBudgetApp(coreApi, prisma);
    const res = await request(app).get("/api/ai-budget/jente/spend");

    expect(res.status).toBe(200);
    expect(res.body.tenantName).toBe("jente");
    expect(res.body.totalCostUsd).toBe(12.5);
    expect(res.body.monthlyBudgetUsd).toBe(100);
    expect(res.body.remainingBudgetUsd).toBe(87.5);
    expect(res.body.topModels).toHaveLength(2);
    expect(res.body.topModels[0].model).toBe("gpt-4.1");
  });


  it("returns synced LiteLLM key metadata from Secret annotations", async () =>
  {
    const prisma = {
      tenant: {
        findUnique: vi.fn().mockResolvedValue({ name: "jente" }),
      },
      tenantLiteLlmKey: {
        findFirst: vi.fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({
            tenant: "jente",
            keyAlias: "opencrane-jente",
            secretName: "openclaw-jente-litellm-key",
            monthlyBudgetUsd: 50,
            issuedAt: new Date("2026-04-06T12:00:00.000Z"),
            revokedAt: null,
            createdAt: new Date("2026-04-06T12:00:00.000Z"),
          }),
        create: vi.fn().mockResolvedValue({}),
      },
    } as unknown as PrismaClient;

    const coreApi = {
      readNamespacedSecret: vi.fn().mockResolvedValue({
        metadata: {
          name: "openclaw-jente-litellm-key",
          annotations: {
            "opencrane.io/litellm-key-alias": "opencrane-jente",
            "opencrane.io/litellm-issued-at": "2026-04-06T12:00:00.000Z",
            "opencrane.io/litellm-monthly-budget-usd": "50",
          },
        },
      }),
    } as unknown as k8s.CoreV1Api;

    const app = _buildAiBudgetApp(coreApi, prisma);
    const res = await request(app).get("/api/ai-budget/jente/litellm-key");

    expect(res.status).toBe(200);
    expect(res.body.tenant).toBe("jente");
    expect(res.body.keyAlias).toBe("opencrane-jente");
    expect(res.body.monthlyBudgetUsd).toBe(50);
    expect(prisma.tenantLiteLlmKey.create).toHaveBeenCalled();
  });

  it("revokes active LiteLLM key metadata and deletes Secret", async () =>
  {
    // No live LiteLLM in this case → the best-effort /key/delete is a no-op (litellmKeyDeleted false).
    delete process.env.LITELLM_ENDPOINT;
    delete process.env.LITELLM_MASTER_KEY;

    const prisma = {
      tenant: {
        findUnique: vi.fn().mockResolvedValue({ name: "jente" }),
      },
      tenantLiteLlmKey: {
        findFirst: vi.fn().mockResolvedValue({
          tenant: "jente",
          keyAlias: "opencrane-jente",
          secretName: "openclaw-jente-litellm-key",
          monthlyBudgetUsd: 50,
          issuedAt: new Date("2026-04-06T12:00:00.000Z"),
          revokedAt: null,
          createdAt: new Date("2026-04-06T12:00:00.000Z"),
        }),
        create: vi.fn().mockResolvedValue({}),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      auditEntry: {
        create: vi.fn().mockResolvedValue({}),
      },
    } as unknown as PrismaClient;

    const coreApi = {
      readNamespacedSecret: vi.fn().mockResolvedValue({
        metadata: {
          name: "openclaw-jente-litellm-key",
          annotations: {
            "opencrane.io/litellm-key-alias": "opencrane-jente",
            "opencrane.io/litellm-issued-at": "2026-04-06T12:00:00.000Z",
            "opencrane.io/litellm-monthly-budget-usd": "50",
          },
        },
      }),
      deleteNamespacedSecret: vi.fn().mockResolvedValue({}),
    } as unknown as k8s.CoreV1Api;

    const app = _buildAiBudgetApp(coreApi, prisma);
    const res = await request(app).post("/api/ai-budget/jente/litellm-key/revoke");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ name: "jente", status: "revoked", secretDeleted: true, litellmKeyDeleted: false });
    expect(prisma.tenantLiteLlmKey.updateMany).toHaveBeenCalled();
    expect(prisma.auditEntry.create).toHaveBeenCalled();
  });

  it("revoke calls LiteLLM /key/delete by alias when configured (best-effort, audited)", async () =>
  {
    // LITELLM env is set by beforeEach, so the upstream delete is attempted.
    const prisma = {
      tenant: {
        findUnique: vi.fn().mockResolvedValue({ name: "jente" }),
      },
      tenantLiteLlmKey: {
        findFirst: vi.fn().mockResolvedValue({
          tenant: "jente",
          keyAlias: "opencrane-jente",
          secretName: "openclaw-jente-litellm-key",
          issuedAt: new Date("2026-04-06T12:00:00.000Z"),
          revokedAt: null,
          createdAt: new Date("2026-04-06T12:00:00.000Z"),
        }),
        create: vi.fn().mockResolvedValue({}),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      auditEntry: {
        create: vi.fn().mockResolvedValue({}),
      },
    } as unknown as PrismaClient;

    const coreApi = {
      // No mounted Secret → the alias is taken from the persisted metadata row instead.
      readNamespacedSecret: vi.fn().mockRejectedValue(new Error("not found")),
      deleteNamespacedSecret: vi.fn().mockResolvedValue({}),
    } as unknown as k8s.CoreV1Api;

    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async function _json() { return {}; } });
    vi.stubGlobal("fetch", fetchSpy);

    const app = _buildAiBudgetApp(coreApi, prisma);
    const res = await request(app).post("/api/ai-budget/jente/litellm-key/revoke");

    expect(res.status).toBe(200);
    expect(res.body.litellmKeyDeleted).toBe(true);

    // The upstream key was deleted by alias with master-key auth.
    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("http://litellm:4000/key/delete");
    expect((init as { headers: Record<string, string> }).headers.Authorization).toBe("Bearer master-key");
    expect(JSON.parse((init as { body: string }).body)).toEqual({ key_aliases: ["opencrane-jente"] });

    // The outcome is recorded in the audit metadata.
    const auditArg = (prisma.auditEntry.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(auditArg.data.metadata.litellmKeyDeleted).toBe(true);
    expect(auditArg.data.metadata.litellmKeyAlias).toBe("opencrane-jente");
  });
});
