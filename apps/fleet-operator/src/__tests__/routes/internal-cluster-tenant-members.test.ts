import express from "express";
import type { Express } from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "../../generated/prisma/index.js";
import type { ZitadelManagementClient } from "../../infra/zitadel/zitadel-client.types.js";
import { _RegisterInternalClusterTenantMembers } from "../../routes/internal/cluster-tenant-members.js";

/**
 * Route tests for the fleet ↔ silo membership seam (#126):
 *   - GET  /:name/members       — the projection SOURCE (S2): authoritative rows + 404;
 *   - POST /:name/members/adopt — the first-login write-through (S4): create-if-absent, never
 *     downgrade, seat the member project role on a genuine create, 404/400 guards.
 */

/** A membership fixture row. */
interface Membership { clusterTenant: string; subject: string; role: string }

/** Org fixture: name → its provisioned Zitadel ids (absent ⇒ a pending, unprovisioned org). */
type OrgFixture = Record<string, { zitadelOrgId?: string; zitadelProjectId?: string }>;

/** Build a Prisma stub over in-memory orgs + memberships (mutated by adopt's create). */
function _mockPrisma(orgs: OrgFixture, seed: Membership[]): PrismaClient
{
  const members = [...seed];
  const api = {
    clusterTenant: {
      findUnique: vi.fn(async function _findUnique(args: { where: { name: string } })
      {
        const org = orgs[args.where.name];
        return org ? { name: args.where.name, zitadelOrgId: org.zitadelOrgId ?? null, zitadelProjectId: org.zitadelProjectId ?? null } : null;
      }),
    },
    orgMembership: {
      findMany: vi.fn(async function _findMany(args: { where: { clusterTenant: string } })
      {
        return members.filter(m => m.clusterTenant === args.where.clusterTenant).map(m => ({ subject: m.subject, role: m.role }));
      }),
      findUnique: vi.fn(async function _findUnique(args: { where: { clusterTenant_subject: { clusterTenant: string; subject: string } } })
      {
        const { clusterTenant, subject } = args.where.clusterTenant_subject;
        const row = members.find(m => m.clusterTenant === clusterTenant && m.subject === subject);
        return row ? { role: row.role } : null;
      }),
      create: vi.fn(async function _create(args: { data: Membership })
      {
        members.push(args.data);
        return { subject: args.data.subject, role: args.data.role };
      }),
    },
    $transaction: async function _tx<T>(fn: (tx: unknown) => Promise<T>): Promise<T> { return fn(api); },
  };
  return api as unknown as PrismaClient;
}

/** Zitadel client stub exposing only the seating grant the adopt path calls. */
function _mockZitadel(): { client: ZitadelManagementClient; grantProjectRole: ReturnType<typeof vi.fn> }
{
  const grantProjectRole = vi.fn(async function _grant() { /* seated */ });
  return { client: { grantProjectRole } as unknown as ZitadelManagementClient, grantProjectRole };
}

/** Mount the internal members router (no session/auth — the outer middleware gates it in prod). */
function _buildApp(prisma: PrismaClient, zitadel: ZitadelManagementClient): Express
{
  const app = express();
  app.use(express.json());
  app.use("/api/internal/cluster-tenants", _RegisterInternalClusterTenantMembers(prisma, zitadel));
  return app;
}

describe("_RegisterInternalClusterTenantMembers — GET fleet→silo source (#126 S2)", function _getSuite()
{
  it("returns the org's authoritative memberships for the silo repairer", async function _lists()
  {
    const prisma = _mockPrisma({ acme: {} }, [
      { clusterTenant: "acme", subject: "owner-1", role: "Owner" },
      { clusterTenant: "acme", subject: "user-2", role: "Member" },
      { clusterTenant: "other", subject: "x", role: "Owner" },
    ]);
    const res = await request(_buildApp(prisma, _mockZitadel().client)).get("/api/internal/cluster-tenants/acme/members");

    expect(res.status).toBe(200);
    expect(res.body.clusterTenant).toBe("acme");
    expect(res.body.members).toEqual([
      { subject: "owner-1", role: "Owner" },
      { subject: "user-2", role: "Member" },
    ]);
  });

  it("returns 404 for an unknown org", async function _missing()
  {
    const res = await request(_buildApp(_mockPrisma({}, []), _mockZitadel().client)).get("/api/internal/cluster-tenants/ghost/members");

    expect(res.status).toBe(404);
    expect(res.body.code).toBe("CLUSTER_TENANT_NOT_FOUND");
  });
});

describe("POST /:name/members/adopt — first-login write-through (#126 S4)", function _adoptSuite()
{
  it("creates a Member and seats its project role when the subject is new", async function _creates()
  {
    const prisma = _mockPrisma({ acme: { zitadelOrgId: "org-a", zitadelProjectId: "proj-a" } }, []);
    const { client, grantProjectRole } = _mockZitadel();
    const res = await request(_buildApp(prisma, client)).post("/api/internal/cluster-tenants/acme/members/adopt").send({ subject: "sub-42" });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ subject: "sub-42", role: "Member", created: true, zitadelSeated: true });
    expect(grantProjectRole).toHaveBeenCalledWith("org-a", "proj-a", "sub-42", "member");
  });

  it("is a no-op that never downgrades an existing Owner", async function _noDowngrade()
  {
    const prisma = _mockPrisma({ acme: { zitadelOrgId: "org-a", zitadelProjectId: "proj-a" } }, [
      { clusterTenant: "acme", subject: "owner-1", role: "Owner" },
    ]);
    const { client, grantProjectRole } = _mockZitadel();
    const res = await request(_buildApp(prisma, client)).post("/api/internal/cluster-tenants/acme/members/adopt").send({ subject: "owner-1" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ subject: "owner-1", role: "Owner", created: false });
    expect(grantProjectRole).not.toHaveBeenCalled();
  });

  it("records the membership without seating when the org is not yet Zitadel-provisioned", async function _unprovisioned()
  {
    const prisma = _mockPrisma({ acme: {} }, []);
    const { client, grantProjectRole } = _mockZitadel();
    const res = await request(_buildApp(prisma, client)).post("/api/internal/cluster-tenants/acme/members/adopt").send({ subject: "sub-7" });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ created: true, zitadelSeated: false });
    expect(grantProjectRole).not.toHaveBeenCalled();
  });

  it("returns 404 for an unknown org and 400 for a missing subject", async function _guards()
  {
    const { client } = _mockZitadel();
    const notFound = await request(_buildApp(_mockPrisma({}, []), client)).post("/api/internal/cluster-tenants/ghost/members/adopt").send({ subject: "s" });
    expect(notFound.status).toBe(404);

    const noSubject = await request(_buildApp(_mockPrisma({ acme: {} }, []), client)).post("/api/internal/cluster-tenants/acme/members/adopt").send({});
    expect(noSubject.status).toBe(400);
    expect(noSubject.body.code).toBe("VALIDATION_ERROR");
  });
});
