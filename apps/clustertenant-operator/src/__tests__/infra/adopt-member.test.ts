import type * as k8s from "@kubernetes/client-node";
import type { PrismaClient } from "@prisma/client";
import type { Logger } from "pino";
import { describe, expect, it, vi } from "vitest";

import { _AdoptMemberOnLogin } from "../../infra/auth/adopt-member.js";
import { _MemberTenantName } from "../../core/cluster-tenants/default-tenant.js";

/**
 * First-login member adoption (#126 S4). A per-org login proves org membership (its
 * `urn:zitadel:iam:org:id` scope restricts it to the org's user pool), so adoption runs
 * exactly when {@link _ResolvePerOrgClient} resolves. These pin: the skip paths (missing
 * identity, masters/platform login), and the per-org path (membership upsert that never
 * downgrades an existing role + subject-bound workspace seed).
 */

function _notFound(): Error
{
  return Object.assign(new Error("not found"), { code: 404 });
}

/** A fully-provisioned ClusterTenant CR for `name` (so per-org resolution returns non-null). */
function _cr(name: string): Record<string, unknown>
{
  return { metadata: { name }, spec: { zitadel: { clientId: `client-${name}`, orgId: `org-${name}` } } };
}

/** CustomObjectsApi stub: resolves the org CR by name, 404s Tenant CRD reads, records CRD creates. */
function _mockApi(orgCr: Record<string, unknown>, tenantCreate: ReturnType<typeof vi.fn>): k8s.CustomObjectsApi
{
  return {
    getClusterCustomObject: vi.fn().mockResolvedValue(orgCr),
    listClusterCustomObject: vi.fn().mockResolvedValue({ items: [] }),
    getNamespacedCustomObject: vi.fn().mockRejectedValue(_notFound()),
    createNamespacedCustomObject: tenantCreate,
  } as unknown as k8s.CustomObjectsApi;
}

function _mockPrisma(opts: {
  modelCount: number;
  upsert: ReturnType<typeof vi.fn>;
  tenantCreate: ReturnType<typeof vi.fn>;
  existingForEmail?: { name: string } | null;
}): PrismaClient
{
  return {
    orgMembership: { upsert: opts.upsert },
    tenant: {
      findUnique: async function _findUnique() { return null; },
      findFirst: async function _findFirst() { return opts.existingForEmail ?? null; },
      create: async function _create(args: { data: Record<string, unknown> }) { opts.tenantCreate(args.data); return args.data; },
    },
    modelDefinition: { count: async function _count() { return opts.modelCount; } },
    auditEntry: { create: async function _create() { return {}; } },
  } as unknown as PrismaClient;
}

const _log = { info: vi.fn(), warn: vi.fn() } as unknown as Logger;

describe("_AdoptMemberOnLogin — first-login org adoption + workspace seed", function _suite()
{
  it("skips (no adoption) when the login carries no subject or email", async function _noIdentity()
  {
    const upsert = vi.fn();
    await _AdoptMemberOnLogin({
      prisma: _mockPrisma({ modelCount: 1, upsert, tenantCreate: vi.fn() }),
      customApi: _mockApi(_cr("acme"), vi.fn()),
      namespace: "ns", host: "acme.dev.opencrane.ai", subject: "", email: "dev@acme.com", fleetWriter: null, log: _log,
    });
    expect(upsert).not.toHaveBeenCalled();
  });

  it("skips a masters/platform login (no per-org client resolves)", async function _masters()
  {
    const upsert = vi.fn();
    await _AdoptMemberOnLogin({
      prisma: _mockPrisma({ modelCount: 1, upsert, tenantCreate: vi.fn() }),
      // customApi=null → _ResolvePerOrgClient returns null (no org to adopt into).
      customApi: null,
      namespace: "ns", host: "app.dev.opencrane.ai", subject: "sub-1", email: "dev@acme.com", fleetWriter: null, log: _log,
    });
    expect(upsert).not.toHaveBeenCalled();
  });

  it("upserts a Member membership (never downgrading) and seeds the subject-bound workspace on a per-org login", async function _adopts()
  {
    const upsert = vi.fn().mockResolvedValue({});
    const tenantCreate = vi.fn();
    await _AdoptMemberOnLogin({
      prisma: _mockPrisma({ modelCount: 1, upsert, tenantCreate }),
      customApi: _mockApi(_cr("acme"), vi.fn()),
      namespace: "ns", host: "acme.dev.opencrane.ai", subject: "sub-42", email: "dev@acme.com", fleetWriter: null, log: _log,
    });

    // Standalone silo (no fleet writer) → adopted into acme's LOCAL read-model as Member,
    // create-if-absent, `update: {}` preserving any existing role.
    expect(upsert).toHaveBeenCalledWith({
      where: { clusterTenant_subject: { clusterTenant: "acme", subject: "sub-42" } },
      create: { clusterTenant: "acme", subject: "sub-42", role: "Member" },
      update: {},
    });
    // Workspace seeded under the member's deterministic, subject-bound name.
    expect(tenantCreate).toHaveBeenCalledWith(expect.objectContaining({
      name: _MemberTenantName("acme", "sub-42"), email: "dev@acme.com", subject: "sub-42", clusterTenantRef: "acme",
    }));
  });

  it("does not create a second workspace when the owner re-logs in through the per-org client", async function _ownerRelogin()
  {
    const upsert = vi.fn().mockResolvedValue({});
    const tenantCreate = vi.fn();
    await _AdoptMemberOnLogin({
      // The owner already holds `acme-default` under their email → the collision guard fires.
      prisma: _mockPrisma({ modelCount: 1, upsert, tenantCreate, existingForEmail: { name: "acme-default" } }),
      customApi: _mockApi(_cr("acme"), vi.fn()),
      namespace: "ns", host: "acme.dev.opencrane.ai", subject: "owner-sub", email: "owner@acme.com", fleetWriter: null, log: _log,
    });

    // Membership upsert is still idempotent with `update: {}` — never downgrading the Owner role...
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ update: {} }));
    // ...but NO second workspace is seeded (a duplicate email would break the 1:1 email→tenant router).
    expect(tenantCreate).not.toHaveBeenCalled();
  });

  it("writes adoption THROUGH to the fleet (not the local read-model) when a fleet writer is present", async function _fleetManaged()
  {
    const upsert = vi.fn();
    const tenantCreate = vi.fn();
    const adopt = vi.fn().mockResolvedValue(true);
    await _AdoptMemberOnLogin({
      prisma: _mockPrisma({ modelCount: 1, upsert, tenantCreate }),
      customApi: _mockApi(_cr("acme"), vi.fn()),
      namespace: "ns", host: "acme.dev.opencrane.ai", subject: "sub-42", email: "dev@acme.com",
      fleetWriter: { adopt }, log: _log,
    });

    // Fleet-managed: the adoption is written through to the fleet SoR (the repairer mirrors it
    // back) — NOT to the local read-model, which the next projection sweep would otherwise reap.
    expect(adopt).toHaveBeenCalledWith("acme", "sub-42");
    expect(upsert).not.toHaveBeenCalled();
    // The workspace seed is silo-local either way.
    expect(tenantCreate).toHaveBeenCalledWith(expect.objectContaining({ name: _MemberTenantName("acme", "sub-42") }));
  });

  it("does NOT seed a workspace when the fleet write-through fails (transient error or seat cap)", async function _writeThroughFailed()
  {
    const tenantCreate = vi.fn();
    const adopt = vi.fn().mockResolvedValue(false); // fleet 409 (seat cap) or transport error
    await _AdoptMemberOnLogin({
      prisma: _mockPrisma({ modelCount: 1, upsert: vi.fn(), tenantCreate }),
      customApi: _mockApi(_cr("acme"), vi.fn()),
      namespace: "ns", host: "acme.dev.opencrane.ai", subject: "sub-42", email: "dev@acme.com",
      fleetWriter: { adopt }, log: _log,
    });

    // No seat ⇒ no workspace: the seed is deferred to a login where the membership write succeeds.
    expect(tenantCreate).not.toHaveBeenCalled();
  });
});
