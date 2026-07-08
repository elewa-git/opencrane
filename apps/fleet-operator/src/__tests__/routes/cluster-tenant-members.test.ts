import express from "express";
import type { Express } from "express";
import type { PrismaClient } from "../../generated/prisma/index.js";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clusterTenantMembersRouter } from "../../routes/cluster-tenant-members.js";
import type { ZitadelManagementClient } from "../../infra/zitadel/zitadel-client.types.js";

/**
 * Route tests for the org MEMBER management API (S3c) + Zitadel seating (#126 S3):
 *   - list / add (upsert) / remove the local OrgMembership rows,
 *   - the last-Owner guardrail (409 on demoting/removing the sole Owner),
 *   - 404 when the org (or membership) is missing,
 *   - the org-manager gate (403 for a non-member; allow operator + owner/admin),
 *   - Zitadel member seating: grant the project role on upsert, roll the DB write back
 *     when the grant throws, and skip the grant for a not-yet-provisioned org.
 */

type Row = Record<string, unknown>;

/** A membership fixture row. `status` defaults to Active when a fixture omits it. */
interface Membership { clusterTenant: string; subject: string; role: "Owner" | "Admin" | "Member"; status?: "Active" | "Suspended" }

/** An org fixture: name plus optional provisioned Zitadel ids (present ⇒ seatable) and seat cap. */
interface OrgFixture { name: string; zitadelOrgId?: string | null; zitadelProjectId?: string | null; seatCap?: number | null }

/** Seed shape for the in-memory fixtures. */
interface Seed
{
  orgs?: Array<string | OrgFixture>;
  memberships?: Membership[];
}

/** A grant call recorded by the fake Zitadel client. */
interface GrantCall { orgId: string; projectId: string; subject: string; roleKey: string }

/** A member-removal call recorded by the fake Zitadel client. */
interface RemoveCall { orgId: string; subject: string }

/** A user-deactivation/reactivation call recorded by the fake Zitadel client. */
interface UserStatusCall { orgId: string; subject: string }

/**
 * Build a fake Zitadel client that records `grantProjectRole` + `removeOrgMember` +
 * `deactivateUser` + `reactivateUser` calls. `throwOnGrant` exercises the upsert transactional
 * rollback; `throwOnRemove` the offboarding retry path; `throwOnDeactivate` the suspend
 * IdP-before-status path (status must not flip on failure); `throwOnReactivate` the reactivate
 * IdP-before-status path (seat + status must roll back on failure).
 */
function _fakeZitadel(opts: { throwOnGrant?: boolean; throwOnRemove?: boolean; throwOnDeactivate?: boolean; throwOnReactivate?: boolean } = {}): { client: ZitadelManagementClient; grants: GrantCall[]; removes: RemoveCall[]; deactivations: UserStatusCall[]; reactivations: UserStatusCall[] }
{
  const grants: GrantCall[] = [];
  const removes: RemoveCall[] = [];
  const deactivations: UserStatusCall[] = [];
  const reactivations: UserStatusCall[] = [];
  const client: ZitadelManagementClient = {
    async provisionOrg(input) { return { orgId: "z", projectId: "p", appId: "a", clientId: "c", redirectUri: input.redirectUri }; },
    async setAppRedirectUris() { /* no-op */ },
    async teardownOrg() { /* no-op */ },
    async grantProjectRole(orgId, projectId, subject, roleKey)
    {
      if (opts.throwOnGrant) { throw new Error("zitadel grant rejected"); }
      grants.push({ orgId, projectId, subject, roleKey });
    },
    async listOrgUsers() { return []; },
    async removeOrgMember(orgId, subject)
    {
      if (opts.throwOnRemove) { throw new Error("zitadel remove rejected"); }
      removes.push({ orgId, subject });
    },
    async deactivateUser(orgId, subject)
    {
      if (opts.throwOnDeactivate) { throw new Error("zitadel deactivate rejected"); }
      deactivations.push({ orgId, subject });
    },
    async reactivateUser(orgId, subject)
    {
      if (opts.throwOnReactivate) { throw new Error("zitadel reactivate rejected"); }
      reactivations.push({ orgId, subject });
    },
    async validateCandidateKey() { return { tokenExchangeOk: true, instanceScopeOk: true, keyId: "k", detail: "ok" }; },
    currentKeyId() { return "k"; },
    reloadKey() { /* no-op */ },
  };
  return { client, grants, removes, deactivations, reactivations };
}

/**
 * Build a Prisma stub backed by in-memory arrays for the membership tables.
 * Implements only the surface the members router touches: clusterTenant.findUnique,
 * orgMembership.{findMany,findUnique,count,upsert,delete}, and a $transaction that runs
 * its callback against the stub (rolling the local rows back if the callback throws).
 */
function _mockPrisma(seed: Seed = {}): { prisma: PrismaClient; memberships: Membership[] }
{
  const orgFixtures = new Map<string, OrgFixture>(
    (seed.orgs ?? []).map(o => typeof o === "string" ? [o, { name: o }] : [o.name, o]),
  );
  const memberships: Membership[] = (seed.memberships ?? []).map(m => ({ ...m }));

  const _find = (clusterTenant: string, subject: string): Membership | undefined =>
    memberships.find(m => m.clusterTenant === clusterTenant && m.subject === subject);

  const prisma = {
    $queryRaw: vi.fn(async function _queryRaw() { return []; }),
    $transaction: vi.fn(async function _transaction(fn: (tx: PrismaClient) => Promise<unknown>)
    {
      // Snapshot for rollback: the seating grant is the last fallible step, so a throw
      // must leave the in-memory rows as they were before the callback ran.
      const snapshot = memberships.map(m => ({ ...m }));
      try { return await fn(prisma); }
      catch (err) { memberships.splice(0, memberships.length, ...snapshot); throw err; }
    }),
    clusterTenant: {
      findUnique: vi.fn(async function _findUnique(args: { where: { name: string }; select?: Record<string, boolean> })
      {
        const org = orgFixtures.get(args.where.name);
        if (!org) { return null; }
        // The stub ignores `select` granularity and returns the fields callers read: the
        // zitadel ids (seating), the seat cap (S6), and the name (existence).
        return { name: org.name, zitadelOrgId: org.zitadelOrgId ?? null, zitadelProjectId: org.zitadelProjectId ?? null, seatCap: org.seatCap ?? null };
      }),
    },
    orgMembership: {
      findMany: vi.fn(async function _findMany(args: { where: { clusterTenant: string } })
      {
        return memberships.filter(m => m.clusterTenant === args.where.clusterTenant).map(m => ({ subject: m.subject, role: m.role, status: m.status ?? "Active" }));
      }),
      findUnique: vi.fn(async function _findUnique(args: { where: { clusterTenant_subject: { clusterTenant: string; subject: string } } })
      {
        const { clusterTenant, subject } = args.where.clusterTenant_subject;
        const m = _find(clusterTenant, subject);
        return m ? { role: m.role, status: m.status ?? "Active" } : null;
      }),
      count: vi.fn(async function _count(args: { where: { clusterTenant: string; role?: string; status?: string } })
      {
        // Role-scoped (owner-count guardrail) OR total (seat-cap check); both now also filter on
        // `status` — a Suspended member frees its seat and does not satisfy the Owner invariant.
        return memberships.filter(m =>
          m.clusterTenant === args.where.clusterTenant
          && (args.where.role === undefined || m.role === args.where.role)
          && (args.where.status === undefined || (m.status ?? "Active") === args.where.status)).length;
      }),
      upsert: vi.fn(async function _upsert(args: { where: { clusterTenant_subject: { clusterTenant: string; subject: string } }; create: Membership; update: { role: Membership["role"] } })
      {
        const { clusterTenant, subject } = args.where.clusterTenant_subject;
        const existing = _find(clusterTenant, subject);
        if (existing) { existing.role = args.update.role; return { subject, role: existing.role }; }
        // A newly created membership defaults to Active (mirrors the Prisma default).
        memberships.push({ status: "Active", ...args.create }); return { subject, role: args.create.role };
      }),
      update: vi.fn(async function _update(args: { where: { clusterTenant_subject: { clusterTenant: string; subject: string } }; data: { status: "Active" | "Suspended" } })
      {
        const { clusterTenant, subject } = args.where.clusterTenant_subject;
        const m = _find(clusterTenant, subject);
        if (m) { m.status = args.data.status; return { subject, role: m.role, status: m.status }; }
        return null;
      }),
      delete: vi.fn(async function _delete(args: { where: { clusterTenant_subject: { clusterTenant: string; subject: string } } })
      {
        const { clusterTenant, subject } = args.where.clusterTenant_subject;
        const idx = memberships.findIndex(m => m.clusterTenant === clusterTenant && m.subject === subject);
        if (idx >= 0) memberships.splice(idx, 1);
        return {};
      }),
    },
  } as unknown as PrismaClient;

  return { prisma, memberships };
}

/** Session user shape (subset of the OIDC session user). */
interface User { sub: string; isPlatformOperator: boolean }

/** Mount the members router under the org `:name`, optionally seeding a session user. */
function _buildApp(prisma: PrismaClient, user?: User, zitadel?: ZitadelManagementClient): Express
{
  const app = express();
  app.use(express.json());
  if (user)
  {
    app.use(function _seedSession(req, _res, next) { (req as unknown as { session: { authUser: User } }).session = { authUser: user }; next(); });
  }
  app.use("/api/v1/cluster-tenants/:name/members", clusterTenantMembersRouter(prisma, zitadel ?? _fakeZitadel().client));
  return app;
}

describe("clusterTenantMembersRouter — org member management (S3c)", function _suite()
{
  const _AUTH_ENV = ["OPENCRANE_API_TOKEN", "OIDC_ISSUER_URL", "OIDC_CLIENT_ID", "OIDC_CLIENT_SECRET", "OIDC_REDIRECT_URI", "OIDC_SESSION_SECRET"] as const;
  const _saved: Record<string, string | undefined> = {};

  /** Force REAL-auth mode so the org-manager gate exercises its fail-closed posture. */
  beforeEach(function _enableAuth()
  {
    for (const key of _AUTH_ENV) { _saved[key] = process.env[key]; delete process.env[key]; }
    process.env.OPENCRANE_API_TOKEN = "ci-token";
  });

  afterEach(function _restoreEnv()
  {
    for (const key of _AUTH_ENV) { if (_saved[key] === undefined) { delete process.env[key]; } else { process.env[key] = _saved[key]; } }
  });

  const _owner: User = { sub: "owner-1", isPlatformOperator: false };

  // --- list ----------------------------------------------------------------

  it("lists the org's members (subject + role) for an owner", async function _list()
  {
    const { prisma } = _mockPrisma({ orgs: ["acme"], memberships: [
      { clusterTenant: "acme", subject: "owner-1", role: "Owner" },
      { clusterTenant: "acme", subject: "user-2", role: "Member" },
    ] });
    const res = await request(_buildApp(prisma, _owner)).get("/api/v1/cluster-tenants/acme/members");

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    // The public list now carries lifecycle status alongside subject + role.
    expect(res.body).toContainEqual({ subject: "user-2", role: "Member", status: "Active" });
  });

  it("returns 404 listing members of a missing org", async function _listMissing()
  {
    const { prisma } = _mockPrisma({ orgs: [] });
    const res = await request(_buildApp(prisma, { sub: "op", isPlatformOperator: true })).get("/api/v1/cluster-tenants/ghost/members");

    expect(res.status).toBe(404);
    expect(res.body.code).toBe("CLUSTER_TENANT_NOT_FOUND");
  });

  // --- add / upsert --------------------------------------------------------

  it("adds a new member (upsert) and returns it", async function _add()
  {
    const { prisma, memberships } = _mockPrisma({ orgs: ["acme"], memberships: [{ clusterTenant: "acme", subject: "owner-1", role: "Owner" }] });
    const res = await request(_buildApp(prisma, _owner)).post("/api/v1/cluster-tenants/acme/members").send({ subject: "user-2", role: "Admin" });

    expect(res.status).toBe(200);
    // Response shape is stable + extended: existing { subject, role } unchanged, `zitadelSeated`
    // is additive (false here since the seed org has no provisioned Zitadel ids).
    expect(res.body).toEqual({ subject: "user-2", role: "Admin", zitadelSeated: false });
    expect(memberships).toContainEqual({ clusterTenant: "acme", subject: "user-2", role: "Admin", status: "Active" });
  });

  it("refuses adding a NEW member with 409 when the org is at its seat cap (S6)", async function _addAtCap()
  {
    const { prisma, memberships } = _mockPrisma({ orgs: [{ name: "acme", seatCap: 1 }], memberships: [{ clusterTenant: "acme", subject: "owner-1", role: "Owner" }] });
    const res = await request(_buildApp(prisma, _owner)).post("/api/v1/cluster-tenants/acme/members").send({ subject: "user-2", role: "Member" });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("SEAT_CAP_EXCEEDED");
    expect(memberships).toHaveLength(1); // no new seat consumed
  });

  it("still allows a role change for an EXISTING member at cap (no new seat)", async function _changeAtCap()
  {
    const { prisma } = _mockPrisma({ orgs: [{ name: "acme", seatCap: 2 }], memberships: [
      { clusterTenant: "acme", subject: "owner-1", role: "Owner" },
      { clusterTenant: "acme", subject: "user-2", role: "Member" },
    ] });
    const res = await request(_buildApp(prisma, _owner)).post("/api/v1/cluster-tenants/acme/members").send({ subject: "user-2", role: "Admin" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ subject: "user-2", role: "Admin" });
  });

  it("updates an existing member's role on upsert", async function _upsert()
  {
    const { prisma, memberships } = _mockPrisma({ orgs: ["acme"], memberships: [
      { clusterTenant: "acme", subject: "owner-1", role: "Owner" },
      { clusterTenant: "acme", subject: "user-2", role: "Member" },
    ] });
    const res = await request(_buildApp(prisma, _owner)).post("/api/v1/cluster-tenants/acme/members").send({ subject: "user-2", role: "Admin" });

    expect(res.status).toBe(200);
    expect(memberships.find(m => m.subject === "user-2")?.role).toBe("Admin");
  });

  it("rejects an add with an invalid role (400)", async function _addBadRole()
  {
    const { prisma } = _mockPrisma({ orgs: ["acme"], memberships: [{ clusterTenant: "acme", subject: "owner-1", role: "Owner" }] });
    const res = await request(_buildApp(prisma, _owner)).post("/api/v1/cluster-tenants/acme/members").send({ subject: "user-2", role: "Superuser" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });

  it("returns 404 adding a member to a missing org", async function _addMissingOrg()
  {
    const { prisma } = _mockPrisma({ orgs: [] });
    const res = await request(_buildApp(prisma, { sub: "op", isPlatformOperator: true })).post("/api/v1/cluster-tenants/ghost/members").send({ subject: "x", role: "Member" });

    expect(res.status).toBe(404);
  });

  // --- last-Owner guardrail ------------------------------------------------

  it("rejects demoting the org's last Owner with 409 LAST_OWNER", async function _demoteLastOwner()
  {
    const { prisma, memberships } = _mockPrisma({ orgs: ["acme"], memberships: [{ clusterTenant: "acme", subject: "owner-1", role: "Owner" }] });
    const res = await request(_buildApp(prisma, _owner)).post("/api/v1/cluster-tenants/acme/members").send({ subject: "owner-1", role: "Admin" });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("LAST_OWNER");
    // The Owner row must be untouched.
    expect(memberships.find(m => m.subject === "owner-1")?.role).toBe("Owner");
  });

  it("allows demoting an Owner when another Owner remains", async function _demoteWithSpareOwner()
  {
    const { prisma, memberships } = _mockPrisma({ orgs: ["acme"], memberships: [
      { clusterTenant: "acme", subject: "owner-1", role: "Owner" },
      { clusterTenant: "acme", subject: "owner-2", role: "Owner" },
    ] });
    const res = await request(_buildApp(prisma, _owner)).post("/api/v1/cluster-tenants/acme/members").send({ subject: "owner-1", role: "Admin" });

    expect(res.status).toBe(200);
    expect(memberships.find(m => m.subject === "owner-1")?.role).toBe("Admin");
  });

  it("rejects removing the org's last Owner with 409 LAST_OWNER", async function _removeLastOwner()
  {
    const { prisma, memberships } = _mockPrisma({ orgs: ["acme"], memberships: [{ clusterTenant: "acme", subject: "owner-1", role: "Owner" }] });
    const res = await request(_buildApp(prisma, _owner)).delete("/api/v1/cluster-tenants/acme/members/owner-1");

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("LAST_OWNER");
    expect(memberships).toHaveLength(1);
  });

  // --- remove --------------------------------------------------------------

  it("removes a non-Owner member", async function _remove()
  {
    const { prisma, memberships } = _mockPrisma({ orgs: ["acme"], memberships: [
      { clusterTenant: "acme", subject: "owner-1", role: "Owner" },
      { clusterTenant: "acme", subject: "user-2", role: "Member" },
    ] });
    const res = await request(_buildApp(prisma, _owner)).delete("/api/v1/cluster-tenants/acme/members/user-2");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ subject: "user-2", status: "removed" });
    expect(memberships.find(m => m.subject === "user-2")).toBeUndefined();
  });

  it("returns 404 removing a member who is not in the org", async function _removeMissingMember()
  {
    const { prisma } = _mockPrisma({ orgs: ["acme"], memberships: [{ clusterTenant: "acme", subject: "owner-1", role: "Owner" }] });
    const res = await request(_buildApp(prisma, _owner)).delete("/api/v1/cluster-tenants/acme/members/ghost");

    expect(res.status).toBe(404);
    expect(res.body.code).toBe("MEMBERSHIP_NOT_FOUND");
  });

  // --- offboarding: revoke the IdP grant before the local delete (#126 S4d) ------------------

  it("revokes the member's Zitadel org membership before deleting the local row (provisioned org)", async function _removeRevokesIdp()
  {
    const { prisma, memberships } = _mockPrisma({ orgs: [{ name: "acme", zitadelOrgId: "z-org", zitadelProjectId: "z-proj" }], memberships: [
      { clusterTenant: "acme", subject: "owner-1", role: "Owner" },
      { clusterTenant: "acme", subject: "user-2", role: "Member" },
    ] });
    const { client, removes } = _fakeZitadel();
    const res = await request(_buildApp(prisma, _owner, client)).delete("/api/v1/cluster-tenants/acme/members/user-2");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ subject: "user-2", status: "removed" });
    // The IdP grant was revoked with the org's provisioned id, and the local row is gone.
    expect(removes).toEqual([{ orgId: "z-org", subject: "user-2" }]);
    expect(memberships.find(m => m.subject === "user-2")).toBeUndefined();
  });

  it("returns 502 and LEAVES the local row when the Zitadel removal fails (no resurrection loop)", async function _removeIdpFailsLeavesRow()
  {
    const { prisma, memberships } = _mockPrisma({ orgs: [{ name: "acme", zitadelOrgId: "z-org", zitadelProjectId: "z-proj" }], memberships: [
      { clusterTenant: "acme", subject: "owner-1", role: "Owner" },
      { clusterTenant: "acme", subject: "user-2", role: "Member" },
    ] });
    const { client } = _fakeZitadel({ throwOnRemove: true });
    const res = await request(_buildApp(prisma, _owner, client)).delete("/api/v1/cluster-tenants/acme/members/user-2");

    // IdP removal must succeed before the local delete: on failure the row survives for retry so
    // the membership-adoption backstop cannot re-add a still-seated member.
    expect(res.status).toBe(502);
    expect(res.body.code).toBe("UPSTREAM_ERROR");
    expect(memberships.find(m => m.subject === "user-2")).toBeDefined();
  });

  // --- org-manager gate ----------------------------------------------------

  it("denies a non-member listing/managing someone else's org members (403)", async function _nonMember()
  {
    const { prisma } = _mockPrisma({ orgs: ["acme"], memberships: [{ clusterTenant: "acme", subject: "owner-1", role: "Owner" }] });
    const app = _buildApp(prisma, { sub: "stranger", isPlatformOperator: false });

    const list = await request(app).get("/api/v1/cluster-tenants/acme/members");
    expect(list.status).toBe(403);
    expect(list.body.code).toBe("FORBIDDEN_ORG_SCOPE");

    const add = await request(app).post("/api/v1/cluster-tenants/acme/members").send({ subject: "x", role: "Member" });
    expect(add.status).toBe(403);
  });

  it("denies a plain Member managing the org's members (403)", async function _plainMember()
  {
    const { prisma } = _mockPrisma({ orgs: ["acme"], memberships: [{ clusterTenant: "acme", subject: "user-3", role: "Member" }] });
    const res = await request(_buildApp(prisma, { sub: "user-3", isPlatformOperator: false })).post("/api/v1/cluster-tenants/acme/members").send({ subject: "x", role: "Member" });

    expect(res.status).toBe(403);
  });

  it("lets a platform operator manage any org's members", async function _operator()
  {
    const { prisma, memberships } = _mockPrisma({ orgs: ["acme"], memberships: [{ clusterTenant: "acme", subject: "owner-1", role: "Owner" }] });
    const res = await request(_buildApp(prisma, { sub: "op", isPlatformOperator: true })).post("/api/v1/cluster-tenants/acme/members").send({ subject: "user-9", role: "Member" });

    expect(res.status).toBe(200);
    expect(memberships).toContainEqual({ clusterTenant: "acme", subject: "user-9", role: "Member", status: "Active" });
  });

  // --- Zitadel member seating (#126 S3) -----------------------------------

  const _provisionedOrg = { name: "acme", zitadelOrgId: "z-org", zitadelProjectId: "z-proj" };

  it("seats the member's Zitadel project role on upsert for a provisioned org", async function _seats()
  {
    const { prisma } = _mockPrisma({ orgs: [_provisionedOrg], memberships: [{ clusterTenant: "acme", subject: "owner-1", role: "Owner" }] });
    const { client, grants } = _fakeZitadel();
    const res = await request(_buildApp(prisma, _owner, client)).post("/api/v1/cluster-tenants/acme/members").send({ subject: "user-2", role: "Admin" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ subject: "user-2", role: "Admin", zitadelSeated: true });
    // The role key is the lower-cased OrgRole; the org's provisioned ids are used.
    expect(grants).toEqual([{ orgId: "z-org", projectId: "z-proj", subject: "user-2", roleKey: "admin" }]);
  });

  it("rolls the membership write back when the Zitadel grant fails (grant is the last fallible step)", async function _rollsBack()
  {
    const { prisma, memberships } = _mockPrisma({ orgs: [_provisionedOrg], memberships: [{ clusterTenant: "acme", subject: "owner-1", role: "Owner" }] });
    const { client } = _fakeZitadel({ throwOnGrant: true });
    const res = await request(_buildApp(prisma, _owner, client)).post("/api/v1/cluster-tenants/acme/members").send({ subject: "user-2", role: "Member" });

    // The IdP failure surfaces (not a 200) and the local row never survives the failed tx.
    expect(res.status).not.toBe(200);
    expect(memberships.find(m => m.subject === "user-2")).toBeUndefined();
  });

  it("records the membership without seating for a not-yet-provisioned org (null Zitadel ids)", async function _noSeat()
  {
    // Org exists but has no Zitadel ids yet (pending) → membership recorded locally, grant skipped.
    const { prisma, memberships } = _mockPrisma({ orgs: [{ name: "acme" }], memberships: [{ clusterTenant: "acme", subject: "owner-1", role: "Owner" }] });
    const { client, grants } = _fakeZitadel();
    const res = await request(_buildApp(prisma, _owner, client)).post("/api/v1/cluster-tenants/acme/members").send({ subject: "user-2", role: "Member" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ subject: "user-2", role: "Member", zitadelSeated: false });
    expect(grants).toHaveLength(0);
    expect(memberships).toContainEqual({ clusterTenant: "acme", subject: "user-2", role: "Member", status: "Active" });
  });

  // --- suspend (#126 license lifecycle) -----------------------------------

  it("suspends a member: deactivates the IdP FIRST, then flips status to Suspended", async function _suspend()
  {
    const { prisma, memberships } = _mockPrisma({ orgs: [_provisionedOrg], memberships: [
      { clusterTenant: "acme", subject: "owner-1", role: "Owner" },
      { clusterTenant: "acme", subject: "user-2", role: "Member" },
    ] });
    const { client, deactivations } = _fakeZitadel();
    const res = await request(_buildApp(prisma, _owner, client)).post("/api/v1/cluster-tenants/acme/members/user-2/suspend");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ subject: "user-2", role: "Member", status: "Suspended" });
    expect(deactivations).toEqual([{ orgId: "z-org", subject: "user-2" }]);
    expect(memberships.find(m => m.subject === "user-2")?.status).toBe("Suspended");
  });

  it("returns 502 and LEAVES status Active when the IdP deactivation fails", async function _suspendIdpFails()
  {
    const { prisma, memberships } = _mockPrisma({ orgs: [_provisionedOrg], memberships: [
      { clusterTenant: "acme", subject: "owner-1", role: "Owner" },
      { clusterTenant: "acme", subject: "user-2", role: "Member", status: "Active" },
    ] });
    const { client } = _fakeZitadel({ throwOnDeactivate: true });
    const res = await request(_buildApp(prisma, _owner, client)).post("/api/v1/cluster-tenants/acme/members/user-2/suspend");

    expect(res.status).toBe(502);
    expect(res.body.code).toBe("UPSTREAM_ERROR");
    expect(memberships.find(m => m.subject === "user-2")?.status ?? "Active").toBe("Active");
  });

  it("refuses suspending the org's last Active Owner with 409 LAST_OWNER", async function _suspendLastOwner()
  {
    const { prisma, memberships } = _mockPrisma({ orgs: [_provisionedOrg], memberships: [{ clusterTenant: "acme", subject: "owner-1", role: "Owner" }] });
    const res = await request(_buildApp(prisma, _owner)).post("/api/v1/cluster-tenants/acme/members/owner-1/suspend");

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("LAST_OWNER");
    expect(memberships.find(m => m.subject === "owner-1")?.status ?? "Active").toBe("Active");
  });

  it("is idempotent: suspending an already-Suspended member is a 200 no-op", async function _suspendIdempotent()
  {
    const { prisma } = _mockPrisma({ orgs: [_provisionedOrg], memberships: [
      { clusterTenant: "acme", subject: "owner-1", role: "Owner" },
      { clusterTenant: "acme", subject: "user-2", role: "Member", status: "Suspended" },
    ] });
    const { client, deactivations } = _fakeZitadel();
    const res = await request(_buildApp(prisma, _owner, client)).post("/api/v1/cluster-tenants/acme/members/user-2/suspend");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ subject: "user-2", role: "Member", status: "Suspended" });
    expect(deactivations).toHaveLength(0); // no second IdP call
  });

  it("returns 404 suspending a member who is not in the org", async function _suspendMissing()
  {
    const { prisma } = _mockPrisma({ orgs: ["acme"], memberships: [{ clusterTenant: "acme", subject: "owner-1", role: "Owner" }] });
    const res = await request(_buildApp(prisma, _owner)).post("/api/v1/cluster-tenants/acme/members/ghost/suspend");

    expect(res.status).toBe(404);
    expect(res.body.code).toBe("MEMBERSHIP_NOT_FOUND");
  });

  it("a suspended member FREES their seat: a new add succeeds at what was the cap", async function _suspendFreesSeat()
  {
    // seatCap=2 with two Active members → at cap. Suspending one frees a seat, so the add below
    // (which would otherwise 409) now succeeds — the crux of the suspend seat semantics.
    const { prisma, memberships } = _mockPrisma({ orgs: [{ name: "acme", zitadelOrgId: "z-org", zitadelProjectId: "z-proj", seatCap: 2 }], memberships: [
      { clusterTenant: "acme", subject: "owner-1", role: "Owner" },
      { clusterTenant: "acme", subject: "user-2", role: "Member" },
    ] });
    const { client } = _fakeZitadel();
    const app = _buildApp(prisma, _owner, client);

    // Before suspension: at cap → a new add is refused.
    const blocked = await request(app).post("/api/v1/cluster-tenants/acme/members").send({ subject: "user-3", role: "Member" });
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe("SEAT_CAP_EXCEEDED");

    // Suspend user-2 → frees a seat.
    const suspend = await request(app).post("/api/v1/cluster-tenants/acme/members/user-2/suspend");
    expect(suspend.status).toBe(200);

    // Now the same add succeeds — the Suspended member no longer counts toward the cap.
    const allowed = await request(app).post("/api/v1/cluster-tenants/acme/members").send({ subject: "user-3", role: "Member" });
    expect(allowed.status).toBe(200);
    expect(memberships.find(m => m.subject === "user-3")).toBeDefined();
  });

  // --- reactivate (#126 license lifecycle) --------------------------------

  it("reactivates a member: reserves a seat, reactivates the IdP, flips status to Active", async function _reactivate()
  {
    const { prisma, memberships } = _mockPrisma({ orgs: [{ name: "acme", zitadelOrgId: "z-org", zitadelProjectId: "z-proj", seatCap: 2 }], memberships: [
      { clusterTenant: "acme", subject: "owner-1", role: "Owner" },
      { clusterTenant: "acme", subject: "user-2", role: "Member", status: "Suspended" },
    ] });
    const { client, reactivations } = _fakeZitadel();
    const res = await request(_buildApp(prisma, _owner, client)).post("/api/v1/cluster-tenants/acme/members/user-2/reactivate");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ subject: "user-2", role: "Member", status: "Active" });
    expect(reactivations).toEqual([{ orgId: "z-org", subject: "user-2" }]);
    expect(memberships.find(m => m.subject === "user-2")?.status).toBe("Active");
  });

  it("refuses reactivation with 409 when the org is at its Active-seat cap", async function _reactivateAtCap()
  {
    // seatCap=1, one Active Owner already fills it. Reactivating the suspended member would exceed
    // the cap → 409, and the member stays Suspended.
    const { prisma, memberships } = _mockPrisma({ orgs: [{ name: "acme", zitadelOrgId: "z-org", zitadelProjectId: "z-proj", seatCap: 1 }], memberships: [
      { clusterTenant: "acme", subject: "owner-1", role: "Owner" },
      { clusterTenant: "acme", subject: "user-2", role: "Member", status: "Suspended" },
    ] });
    const { client, reactivations } = _fakeZitadel();
    const res = await request(_buildApp(prisma, _owner, client)).post("/api/v1/cluster-tenants/acme/members/user-2/reactivate");

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("SEAT_CAP_EXCEEDED");
    expect(reactivations).toHaveLength(0);
    expect(memberships.find(m => m.subject === "user-2")?.status).toBe("Suspended");
  });

  it("succeeds when a seat is free (a freed seat lets a suspended member back in)", async function _reactivateSeatFree()
  {
    // seatCap=2, one Active Owner + one Suspended member → one free seat → reactivation succeeds.
    const { prisma, memberships } = _mockPrisma({ orgs: [{ name: "acme", zitadelOrgId: "z-org", zitadelProjectId: "z-proj", seatCap: 2 }], memberships: [
      { clusterTenant: "acme", subject: "owner-1", role: "Owner" },
      { clusterTenant: "acme", subject: "user-2", role: "Member", status: "Suspended" },
    ] });
    const res = await request(_buildApp(prisma, _owner, _fakeZitadel().client)).post("/api/v1/cluster-tenants/acme/members/user-2/reactivate");

    expect(res.status).toBe(200);
    expect(memberships.find(m => m.subject === "user-2")?.status).toBe("Active");
  });

  it("returns 502 and LEAVES status Suspended when the IdP reactivation fails", async function _reactivateIdpFails()
  {
    const { prisma, memberships } = _mockPrisma({ orgs: [{ name: "acme", zitadelOrgId: "z-org", zitadelProjectId: "z-proj", seatCap: 5 }], memberships: [
      { clusterTenant: "acme", subject: "owner-1", role: "Owner" },
      { clusterTenant: "acme", subject: "user-2", role: "Member", status: "Suspended" },
    ] });
    const { client } = _fakeZitadel({ throwOnReactivate: true });
    const res = await request(_buildApp(prisma, _owner, client)).post("/api/v1/cluster-tenants/acme/members/user-2/reactivate");

    expect(res.status).toBe(502);
    expect(res.body.code).toBe("UPSTREAM_ERROR");
    // Seat + status rolled back by the failed tx — the member stays Suspended.
    expect(memberships.find(m => m.subject === "user-2")?.status).toBe("Suspended");
  });

  it("is idempotent: reactivating an already-Active member is a 200 no-op (no seat consumed)", async function _reactivateIdempotent()
  {
    const { prisma } = _mockPrisma({ orgs: [{ name: "acme", zitadelOrgId: "z-org", zitadelProjectId: "z-proj", seatCap: 1 }], memberships: [
      { clusterTenant: "acme", subject: "owner-1", role: "Owner", status: "Active" },
    ] });
    const { client, reactivations } = _fakeZitadel();
    const res = await request(_buildApp(prisma, _owner, client)).post("/api/v1/cluster-tenants/acme/members/owner-1/reactivate");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ subject: "owner-1", role: "Owner", status: "Active" });
    expect(reactivations).toHaveLength(0);
  });

  it("returns 404 reactivating a member who is not in the org", async function _reactivateMissing()
  {
    const { prisma } = _mockPrisma({ orgs: ["acme"], memberships: [{ clusterTenant: "acme", subject: "owner-1", role: "Owner" }] });
    const res = await request(_buildApp(prisma, _owner)).post("/api/v1/cluster-tenants/acme/members/ghost/reactivate");

    expect(res.status).toBe(404);
    expect(res.body.code).toBe("MEMBERSHIP_NOT_FOUND");
  });
});
