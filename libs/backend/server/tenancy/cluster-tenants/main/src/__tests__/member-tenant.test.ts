import type { PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { _EnsureMemberTenant, _MemberTenantName } from "../core/default-tenant.js";

/**
 * Member-workspace seeding (#126 S4): an adopted member gets a subject-bound Tenant of their
 * own, keyed by {@link _MemberTenantName} rather than `<org>-default`. These pin the naming
 * invariant and the three guard branches: the ≥1-model onboarding gate, the owner/email
 * collision guard (the router is 1:1 per (email, silo)), and the happy-path dual-write.
 */

/**
 * Minimal Prisma stub for the no-cluster (customApi=null) seed path.
 * `modelCount` drives the onboarding gate; `existingForEmail` drives the collision guard.
 */
function _mockPrisma(opts: {
  modelCount: number;
  existingForEmail?: { name: string } | null;
  onCreate?: (data: Record<string, unknown>) => void;
}): PrismaClient
{
  return {
    tenant: {
      findUnique: async function _findUnique() { return null; },
      findFirst: async function _findFirst() { return opts.existingForEmail ?? null; },
      create: async function _create(args: { data: Record<string, unknown> }) { opts.onCreate?.(args.data); return args.data; },
    },
    modelDefinition: {
      count: async function _count() { return opts.modelCount; },
    },
    auditEntry: {
      create: async function _create() { return {}; },
    },
  } as unknown as PrismaClient;
}

describe("_MemberTenantName — deterministic, DNS-safe per-member workspace name", function _nameSuite()
{
  it("is stable for the same (org, subject) and formatted `<org>-u-<10hex>`", function _stable()
  {
    const a = _MemberTenantName("acme", "1234567890");
    const b = _MemberTenantName("acme", "1234567890");
    expect(a).toBe(b);
    expect(a).toMatch(/^acme-u-[0-9a-f]{10}$/);
  });

  it("differs by subject so two members never collide", function _distinct()
  {
    expect(_MemberTenantName("acme", "111")).not.toBe(_MemberTenantName("acme", "222"));
  });

  it("keeps `openclaw-<name>` within the 63-char Service-name limit for a long org name", function _bounded()
  {
    const longOrg = "a".repeat(40);
    const service = `openclaw-${_MemberTenantName(longOrg, "999888777666")}`;
    expect(service.length).toBeLessThanOrEqual(63);
  });
});

describe("_EnsureMemberTenant — subject-bound member workspace seed", function _seedSuite()
{
  it("seeds a subject-bound workspace when ≥1 model exists and the email is unclaimed", async function _seeds()
  {
    const created: Record<string, unknown>[] = [];
    const res = await _EnsureMemberTenant({
      customApi: null,
      prisma: _mockPrisma({ modelCount: 1, existingForEmail: null, onCreate: (d) => created.push(d) }),
      namespace: "ns", orgName: "acme", email: "dev@acme.com", subject: "sub-42",
    });

    expect(res.created).toBe(true);
    expect(res.tenantName).toBe(_MemberTenantName("acme", "sub-42"));
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ email: "dev@acme.com", subject: "sub-42", clusterTenantRef: "acme" });
  });

  it("skips (no create) when no model is registered for the org", async function _gated()
  {
    const created: Record<string, unknown>[] = [];
    const res = await _EnsureMemberTenant({
      customApi: null,
      prisma: _mockPrisma({ modelCount: 0, existingForEmail: null, onCreate: (d) => created.push(d) }),
      namespace: "ns", orgName: "acme", email: "dev@acme.com", subject: "sub-42",
    });

    expect(res.created).toBe(false);
    expect(res.skippedReason).toMatch(/no models registered/i);
    expect(created).toHaveLength(0);
  });

  it("never creates a second workspace for an email already claimed in the silo (owner-collision guard)", async function _collision()
  {
    const created: Record<string, unknown>[] = [];
    const res = await _EnsureMemberTenant({
      customApi: null,
      prisma: _mockPrisma({ modelCount: 1, existingForEmail: { name: "acme-default" }, onCreate: (d) => created.push(d) }),
      namespace: "ns", orgName: "acme", email: "owner@acme.com", subject: "owner-sub",
    });

    expect(res.created).toBe(false);
    expect(res.skippedReason).toMatch(/already has a workspace/i);
    expect(res.tenantName).toBe("acme-default");
    expect(created).toHaveLength(0);
  });
});
