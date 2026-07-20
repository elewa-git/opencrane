import type * as k8s from "@kubernetes/client-node";
import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { _DetectPolicyProjectionDrift, _DetectTenantProjectionDrift } from "../index.js";

describe("projection drift routes", function ()
{
  it("reports tenant field drift without changing the existing tenant routes", async function ()
  {
    const customApi = {
      listNamespacedCustomObject: vi.fn().mockResolvedValue({
        items: [
          {
            metadata: { name: "alpha" },
            spec: {
              displayName: "Alpha From CRD",
              email: "alpha@example.com",
              team: "platform",
            },
          },
        ],
      }),
    } as unknown as k8s.CustomObjectsApi;

    const prisma = {
      tenant: {
        findMany: vi.fn().mockResolvedValue([
          {
            name: "alpha",
            displayName: "Alpha From DB",
            email: "alpha@example.com",
            team: "platform",
          },
        ]),
      },
    } as unknown as PrismaClient;

    const report = await _DetectTenantProjectionDrift(customApi, prisma, "default");

    expect(report.resource).toBe("Tenant");
    expect(report.mode).toBe("detect-only");
    expect(report.summary).toEqual({
      sourceCount: 1,
      projectionCount: 1,
      driftCount: 1,
    });
    expect(report.mismatches).toEqual([
      {
        name: "alpha",
        issue: "field-mismatch",
        fields: ["displayName"],
      },
    ]);
  });

  it("reports missing projection rows for policies", async function ()
  {
    const customApi = {
      listNamespacedCustomObject: vi.fn().mockResolvedValue({
        items: [
          {
            metadata: { name: "default-deny" },
            spec: {
              description: "Default deny policy",
              domains: { deny: ["*"] },
            },
          },
        ],
      }),
    } as unknown as k8s.CustomObjectsApi;

    const prisma = {
      accessPolicy: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    } as unknown as PrismaClient;

    const report = await _DetectPolicyProjectionDrift(customApi, prisma, "default");

    expect(report.resource).toBe("AccessPolicy");
    expect(report.summary).toEqual({
      sourceCount: 1,
      projectionCount: 0,
      driftCount: 1,
    });
    expect(report.mismatches).toEqual([
      {
        name: "default-deny",
        issue: "missing-projection",
      },
    ]);
  });
});
