import type * as k8s from "@kubernetes/client-node";
import type { PrismaClient } from "@prisma/client";
import pino from "pino";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MembershipProjectionRepairer, _BuildHttpFleetMembershipReader } from "../../infra/membership-projection-repairer.js";
import type { FleetMembershipReader, FleetMembershipRow, MembershipEnforcementDeps } from "../../infra/membership-projection-repairer.types.js";
import type { OpenClawGatewayAdmin } from "../../core/connections/gateway-admin.types.js";

const _log = pino({ enabled: false });

/** A local membership row (silo read-model); `status` defaults to Active when omitted. */
interface Row { clusterTenant: string; subject: string; role: string; status?: string }

/** A per-member workspace tenant fixture (name + owning org + subject binding). */
interface TenantFixture { name: string; clusterTenantRef: string; subject: string }

/**
 * Build a Prisma stub over an in-memory OrgMembership table (+ optional tenant + brokeredDevice
 * fixtures for enforcement). Implements the surface the repairer touches:
 * orgMembership.{findMany,upsert,delete}, tenant.findFirst, brokeredDevice.{findMany,updateMany}.
 */
function _mockPrisma(seed: Row[] = [], tenants: TenantFixture[] = []): { prisma: PrismaClient; rows: Row[] }
{
  const rows: Row[] = seed.map(r => ({ ...r }));
  const prisma = {
    orgMembership: {
      findMany: vi.fn(async function _findMany(args: { where: { clusterTenant: string } })
      {
        return rows.filter(r => r.clusterTenant === args.where.clusterTenant).map(r => ({ subject: r.subject, role: r.role, status: r.status ?? "Active" }));
      }),
      upsert: vi.fn(async function _upsert(args: { where: { clusterTenant_subject: { clusterTenant: string; subject: string } }; create: Row; update: { role: string; status: string } })
      {
        const { clusterTenant, subject } = args.where.clusterTenant_subject;
        const existing = rows.find(r => r.clusterTenant === clusterTenant && r.subject === subject);
        if (existing) { existing.role = args.update.role; existing.status = args.update.status; return existing; }
        const created = { ...args.create }; rows.push(created); return created;
      }),
      delete: vi.fn(async function _delete(args: { where: { clusterTenant_subject: { clusterTenant: string; subject: string } } })
      {
        const { clusterTenant, subject } = args.where.clusterTenant_subject;
        const idx = rows.findIndex(r => r.clusterTenant === clusterTenant && r.subject === subject);
        if (idx >= 0) rows.splice(idx, 1);
        return {};
      }),
    },
    tenant: {
      findFirst: vi.fn(async function _findFirst(args: { where: { clusterTenantRef: string; subject: string } })
      {
        const t = tenants.find(t => t.clusterTenantRef === args.where.clusterTenantRef && t.subject === args.where.subject);
        return t ? { name: t.name } : null;
      }),
    },
    brokeredDevice: {
      findMany: vi.fn(async function _bdFindMany() { return []; }),
      updateMany: vi.fn(async function _bdUpdateMany() { return { count: 0 }; }),
    },
  } as unknown as PrismaClient;
  return { prisma, rows };
}

/** A Tenant CR suspend/resume patch recorded by the fake CustomObjectsApi. */
interface SuspendPatch { name: string; suspended: boolean }

/** A per-subject cut recorded by the fake CoreV1 pod deletion (subject scope ⇒ no pod delete). */
interface PodDelete { namespace: string; labelSelector: string }

/**
 * Build enforcement deps whose k8s/gateway clients record what the repairer drives:
 * `patches` (Tenant CR spec.suspended flips) and `podDeletes` (full-tenant cuts — none expected on
 * a per-subject membership cut). `throwOnPatch` forces the Tenant patch to reject.
 */
function _mockEnforcement(opts: { throwOnPatch?: boolean } = {}): { deps: MembershipEnforcementDeps; patches: SuspendPatch[]; podDeletes: PodDelete[]; cuts: string[] }
{
  const patches: SuspendPatch[] = [];
  const podDeletes: PodDelete[] = [];
  const cuts: string[] = [];
  const customApi = {
    patchNamespacedCustomObject: vi.fn(async function _patch(args: { name: string; body: { spec: { suspended: boolean } } })
    {
      if (opts.throwOnPatch) { throw new Error("patch rejected"); }
      patches.push({ name: args.name, suspended: args.body.spec.suspended });
      return {};
    }),
  } as unknown as k8s.CustomObjectsApi;
  const coreApi = {
    deleteCollectionNamespacedPod: vi.fn(async function _del(args: { namespace: string; labelSelector: string })
    {
      podDeletes.push({ namespace: args.namespace, labelSelector: args.labelSelector });
      return {};
    }),
  } as unknown as k8s.CoreV1Api;
  const gatewayAdmin: OpenClawGatewayAdmin = {
    async revokeConnections(params: { tenant: string })
    {
      cuts.push(params.tenant);
      return { ok: true, revokedCount: 0, message: "ok" };
    },
  };
  return { deps: { customApi, coreApi, gatewayAdmin, namespace: "opencrane-acme" }, patches, podDeletes, cuts };
}

/** A reader that returns a fixed set (or null to signal source-unavailable). */
function _fixedReader(result: FleetMembershipRow[] | null): FleetMembershipReader
{
  return { read: vi.fn(async function _read() { return result; }) };
}

/** Run one sweep by starting + stopping (an immediate sweep fires on start). */
async function _sweepOnce(repairer: MembershipProjectionRepairer): Promise<void>
{
  repairer.start();
  await new Promise(function _r(resolve) { setTimeout(resolve, 0); });
  repairer.stop();
}

describe("MembershipProjectionRepairer._reconcile", function _reconcileSuite()
{
  afterEach(function _reset() { vi.restoreAllMocks(); });

  it("creates local rows for members the fleet has that the silo lacks", async function _creates()
  {
    const { prisma, rows } = _mockPrisma([]);
    const reader = _fixedReader([{ subject: "user-2", role: "Member" }, { subject: "owner-1", role: "Owner" }]);
    await _sweepOnce(new MembershipProjectionRepairer(prisma, reader, "acme", _log, 60_000));

    // Status is projected; a wire row with no status defaults to Active.
    expect(rows).toContainEqual({ clusterTenant: "acme", subject: "user-2", role: "Member", status: "Active" });
    expect(rows).toContainEqual({ clusterTenant: "acme", subject: "owner-1", role: "Owner", status: "Active" });
  });

  it("projects a Suspended status off the wire (and defaults an absent/unknown status to Active)", async function _projectsStatus()
  {
    const { prisma, rows } = _mockPrisma([]);
    const reader = _fixedReader([
      { subject: "susp", role: "Member", status: "Suspended" },
      { subject: "act", role: "Member", status: "Active" },
      { subject: "unk", role: "Member", status: "weird" },
      { subject: "abs", role: "Member" },
    ]);
    // Capturing logger (the repairer derives a child, so spy the child surface directly).
    const warn = vi.fn();
    const capturing = { warn, info: vi.fn(), error: vi.fn(), debug: vi.fn(), child() { return capturing; } } as unknown as typeof _log;
    await _sweepOnce(new MembershipProjectionRepairer(prisma, reader, "acme", capturing, 60_000));

    expect(rows.find(r => r.subject === "susp")?.status).toBe("Suspended");
    expect(rows.find(r => r.subject === "act")?.status).toBe("Active");
    expect(rows.find(r => r.subject === "unk")?.status).toBe("Active"); // unknown ⇒ Active (fail-open)
    expect(rows.find(r => r.subject === "abs")?.status).toBe("Active"); // absent ⇒ Active
    // The PRESENT-but-unrecognized "weird" value is surfaced (schema skew); absent is silent.
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({ rawStatus: "weird", subject: "unk" }), expect.stringMatching(/unrecognized OrgMembership status/));
  });

  it("re-upserts when only the status drifts (Active → Suspended)", async function _statusDrift()
  {
    const { prisma, rows } = _mockPrisma([{ clusterTenant: "acme", subject: "user-2", role: "Member", status: "Active" }]);
    const reader = _fixedReader([{ subject: "user-2", role: "Member", status: "Suspended" }]);
    await _sweepOnce(new MembershipProjectionRepairer(prisma, reader, "acme", _log, 60_000));

    expect(rows.find(r => r.subject === "user-2")?.status).toBe("Suspended");
  });

  it("corrects a drifted role and removes members the fleet no longer lists", async function _driftsAndRemoves()
  {
    const { prisma, rows } = _mockPrisma([
      { clusterTenant: "acme", subject: "user-2", role: "Member" },
      { clusterTenant: "acme", subject: "stale", role: "Member" },
    ]);
    const reader = _fixedReader([{ subject: "user-2", role: "Admin" }]);
    await _sweepOnce(new MembershipProjectionRepairer(prisma, reader, "acme", _log, 60_000));

    expect(rows.find(r => r.subject === "user-2")?.role).toBe("Admin");
    expect(rows.find(r => r.subject === "stale")).toBeUndefined();
  });

  it("ignores fleet rows with an unrecognised role (never persists a bad role)", async function _badRole()
  {
    const { prisma, rows } = _mockPrisma([]);
    const reader = _fixedReader([{ subject: "user-2", role: "Superuser" }]);
    await _sweepOnce(new MembershipProjectionRepairer(prisma, reader, "acme", _log, 60_000));

    expect(rows).toHaveLength(0);
  });

  it("is a safe no-op when the reader returns null (source unavailable) — local rows survive", async function _nullNoOp()
  {
    const { prisma, rows } = _mockPrisma([{ clusterTenant: "acme", subject: "local-only", role: "Member" }]);
    const reader = _fixedReader(null);
    await _sweepOnce(new MembershipProjectionRepairer(prisma, reader, "acme", _log, 60_000));

    // A null read must NOT wipe locally-managed rows (the #151 standalone guarantee).
    expect(rows).toEqual([{ clusterTenant: "acme", subject: "local-only", role: "Member" }]);
  });

  it("does not sweep when disabled (interval <= 0)", async function _disabled()
  {
    const { prisma } = _mockPrisma([]);
    const reader = _fixedReader([{ subject: "x", role: "Member" }]);
    const repairer = new MembershipProjectionRepairer(prisma, reader, "acme", _log, 0);
    await _sweepOnce(repairer);
    expect(reader.read).not.toHaveBeenCalled();
  });

  it("does not sweep when no cluster tenant is configured", async function _noOrg()
  {
    const { prisma } = _mockPrisma([]);
    const reader = _fixedReader([{ subject: "x", role: "Member" }]);
    const repairer = new MembershipProjectionRepairer(prisma, reader, "", _log, 60_000);
    await _sweepOnce(repairer);
    expect(reader.read).not.toHaveBeenCalled();
  });
});

describe("MembershipProjectionRepairer._enforceStatuses — suspension enforcement (#126)", function _enforceSuite()
{
  afterEach(function _reset() { vi.restoreAllMocks(); });

  it("suspends a Suspended member's workspace pod (patch spec.suspended: true)", async function _suspends()
  {
    const { prisma } = _mockPrisma([], [{ name: "ws-user2", clusterTenantRef: "acme", subject: "user-2" }]);
    const reader = _fixedReader([{ subject: "user-2", role: "Member", status: "Suspended" }]);
    const { deps, patches } = _mockEnforcement();
    await _sweepOnce(new MembershipProjectionRepairer(prisma, reader, "acme", _log, 60_000, deps));

    expect(patches).toContainEqual({ name: "ws-user2", suspended: true });
  });

  it("cuts the Suspended member per-subject (does NOT force-delete the shared pod)", async function _cuts()
  {
    const { prisma } = _mockPrisma([], [{ name: "ws-user2", clusterTenantRef: "acme", subject: "user-2" }]);
    const reader = _fixedReader([{ subject: "user-2", role: "Member", status: "Suspended" }]);
    const { deps, podDeletes } = _mockEnforcement();
    await _sweepOnce(new MembershipProjectionRepairer(prisma, reader, "acme", _log, 60_000, deps));

    // A per-subject cut severs the member's sessions/devices but never force-deletes the pod
    // (that would sign out everyone on the shared per-tenant pod).
    expect(podDeletes).toHaveLength(0);
  });

  it("clears the suspension for an Active member (patch spec.suspended: false)", async function _resumes()
  {
    const { prisma } = _mockPrisma([], [{ name: "ws-user2", clusterTenantRef: "acme", subject: "user-2" }]);
    const reader = _fixedReader([{ subject: "user-2", role: "Member", status: "Active" }]);
    const { deps, patches } = _mockEnforcement();
    await _sweepOnce(new MembershipProjectionRepairer(prisma, reader, "acme", _log, 60_000, deps));

    expect(patches).toContainEqual({ name: "ws-user2", suspended: false });
  });

  it("no-ops enforcement for a member with no workspace tenant in this silo", async function _noWorkspace()
  {
    const { prisma } = _mockPrisma([], []); // no tenant fixtures → findFirst returns null
    const reader = _fixedReader([{ subject: "no-ws", role: "Admin", status: "Suspended" }]);
    const { deps, patches } = _mockEnforcement();
    await _sweepOnce(new MembershipProjectionRepairer(prisma, reader, "acme", _log, 60_000, deps));

    expect(patches).toHaveLength(0);
  });

  it("is projection-only when no enforcement clients are wired (standalone)", async function _projectionOnly()
  {
    const { prisma, rows } = _mockPrisma([], [{ name: "ws-user2", clusterTenantRef: "acme", subject: "user-2" }]);
    const reader = _fixedReader([{ subject: "user-2", role: "Member", status: "Suspended" }]);
    // No enforcement arg → the status still projects, but nothing is cut/patched.
    await _sweepOnce(new MembershipProjectionRepairer(prisma, reader, "acme", _log, 60_000));

    expect(rows.find(r => r.subject === "user-2")?.status).toBe("Suspended");
  });

  it("isolates an enforcement failure for one member (logged, sweep survives)", async function _isolatesFailure()
  {
    const { prisma, rows } = _mockPrisma([], [{ name: "ws-user2", clusterTenantRef: "acme", subject: "user-2" }]);
    const reader = _fixedReader([{ subject: "user-2", role: "Member", status: "Suspended" }]);
    const { deps } = _mockEnforcement({ throwOnPatch: true });
    // A patch failure must not throw out of the sweep — the projection still landed.
    await _sweepOnce(new MembershipProjectionRepairer(prisma, reader, "acme", _log, 60_000, deps));

    expect(rows.find(r => r.subject === "user-2")?.status).toBe("Suspended");
  });
});

describe("_BuildHttpFleetMembershipReader — standalone-safe fleet read (#126 S2)", function _readerSuite()
{
  it("returns null (no-op) when no fleet URL is configured (#151 standalone)", async function _standalone()
  {
    const reader = _BuildHttpFleetMembershipReader("", "", _log, (async () => { throw new Error("must not fetch"); }) as unknown as typeof fetch);
    await expect(reader.read("acme")).resolves.toBeNull();
  });

  it("returns the members array on a 200 response, with the bearer token attached", async function _ok()
  {
    let seenAuth: string | undefined;
    const fetchImpl = (async function _f(_url: string, init: { headers?: Record<string, string> }) {
      seenAuth = init?.headers?.authorization;
      return { ok: true, status: 200, json: async () => ({ clusterTenant: "acme", members: [{ subject: "u1", role: "Owner" }] }) };
    }) as unknown as typeof fetch;
    const reader = _BuildHttpFleetMembershipReader("http://fleet:8080", "svc-token", _log, fetchImpl);

    await expect(reader.read("acme")).resolves.toEqual([{ subject: "u1", role: "Owner" }]);
    expect(seenAuth).toBe("Bearer svc-token");
  });

  it("returns null (no-op) on a non-OK status", async function _nonOk()
  {
    const fetchImpl = (async () => ({ ok: false, status: 503, json: async () => ({}) })) as unknown as typeof fetch;
    const reader = _BuildHttpFleetMembershipReader("http://fleet:8080", "t", _log, fetchImpl);
    await expect(reader.read("acme")).resolves.toBeNull();
  });

  it("returns null (no-op) when the fleet is unreachable (fetch throws)", async function _unreachable()
  {
    const fetchImpl = (async () => { throw new Error("ECONNREFUSED"); }) as unknown as typeof fetch;
    const reader = _BuildHttpFleetMembershipReader("http://fleet:8080", "t", _log, fetchImpl);
    await expect(reader.read("acme")).resolves.toBeNull();
  });
});
