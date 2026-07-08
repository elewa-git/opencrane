import { Router } from "express";
import type { Request } from "express";
import { Prisma, type PrismaClient } from "../generated/prisma/index.js";

import { _RequireOrgManager } from "@opencrane/infra-auth";
import { _log } from "../log.js";
import type { ZitadelManagementClient } from "../infra/zitadel/zitadel-client.types.js";

/** The org roles a membership may hold (mirrors the Prisma `OrgRole` enum). */
const _ORG_ROLES = ["Owner", "Admin", "Member"] as const;

/** A single valid org role. */
type OrgRoleValue = (typeof _ORG_ROLES)[number];

/**
 * Map an `OrgRole` to the Zitadel project role key `provisionOrg` bulk-creates
 * (`owner`/`admin`/`member`). The seating grant an org member receives is the
 * lower-cased role, so an Owner/Admin gets project-admin authority and a Member
 * gets plain participation on the org's `opencrane` project.
 */
export function _zitadelRoleKey(role: OrgRoleValue): string
{
  return role.toLowerCase();
}

/** Request body for adding/updating a member. */
interface MemberWriteBody
{
  /** IdP-verified subject (OIDC `sub`) of the member to add/update. */
  subject?: unknown;
  /** Role to grant within the org (Owner | Admin | Member). */
  role?: unknown;
}

/** Whether a value is one of the three valid org roles. */
function _isOrgRole(value: unknown): value is OrgRoleValue
{
  return typeof value === "string" && (_ORG_ROLES as readonly string[]).includes(value);
}

/**
 * Whether the named org exists, used to return 404 before touching memberships.
 *
 * @param prisma - Prisma client for the lookup.
 * @param name   - ClusterTenant (org) name from the path.
 * @returns True when a ClusterTenant row with that name exists.
 */
export async function _orgExists(prisma: PrismaClient, name: string): Promise<boolean>
{
  const row = await prisma.clusterTenant.findUnique({ where: { name }, select: { name: true } });
  return row !== null;
}

/**
 * Read the org's provisioned Zitadel identifiers — the inputs the member-seating
 * grant needs. Null when the org is absent OR not yet Zitadel-provisioned (a
 * `pending` org whose Zitadel org/project ids are still null); the caller then
 * records the membership locally and skips the IdP grant.
 *
 * @param prisma - Prisma client for the lookup.
 * @param name   - ClusterTenant (org) name.
 * @returns The org's `{ orgId, projectId }` when both are set, else null.
 */
export async function _readOrgZitadelIds(prisma: PrismaClient, name: string): Promise<{ orgId: string; projectId: string } | null>
{
  const row = await prisma.clusterTenant.findUnique({ where: { name }, select: { zitadelOrgId: true, zitadelProjectId: true } });
  if (!row || !row.zitadelOrgId || !row.zitadelProjectId)
  {
    return null;
  }
  return { orgId: row.zitadelOrgId, projectId: row.zitadelProjectId };
}

/**
 * Count the org's current ACTIVE `Owner` memberships — the guardrail input for the last-Owner
 * invariant (an org must always retain at least one Active Owner who can actually manage it). A
 * Suspended Owner cannot administer the org, so it does not satisfy the invariant and is excluded
 * from the count: demoting/removing/suspending the sole Active Owner is refused.
 *
 * @param prisma - Prisma client for the count.
 * @param orgName - ClusterTenant (org) name.
 * @returns The number of Active `Owner` memberships in the org.
 */
async function _ownerCount(prisma: PrismaClient, orgName: string): Promise<number>
{
  return prisma.orgMembership.count({ where: { clusterTenant: orgName, role: "Owner", status: "Active" } });
}

/** Error code returned when a member-create would exceed the org's seat cap. */
export const _SEAT_CAP_EXCEEDED_CODE = "SEAT_CAP_EXCEEDED";

/** Thrown by {@link _reserveSeatInTx} when the org is at its seat cap; mapped to a 409 by callers. */
export class SeatCapExceededError extends Error
{
  constructor()
  {
    super("Organisation is at its seat cap.");
    this.name = "SeatCapExceededError";
  }
}

/**
 * Reserve a seat for a member that will occupy one, inside the write transaction (#126). The
 * fleet is the seat authority: an org's `seatCap` (null ⇒ uncapped) bounds the number of ACTIVE
 * memberships. A Suspended member does NOT consume a seat, so this counts only `status: "Active"`
 * rows — the decision that makes suspension free the seat and reactivation contend for one.
 *
 * Call this on the create path (a new member) AND on the reactivate path (a Suspended → Active
 * flip re-occupies a seat), but NOT on a role change (an already-Active member consumes no new
 * seat). Call it ONLY from within the `$transaction` that then writes the row: it first takes a
 * row lock on the org (`SELECT … FOR UPDATE`), so concurrent seat-consuming writes for the SAME
 * org serialize and the count→write window cannot interleave — the cap is exact, not a racy
 * check-then-act. Different orgs never contend on the lock, and standalone silos never reach the
 * fleet at all.
 *
 * @param tx      - The active transaction client (a row lock outside a tx would release immediately).
 * @param orgName - ClusterTenant (org) name.
 * @throws {SeatCapExceededError} when the org is capped and already at its Active-seat cap.
 */
export async function _reserveSeatInTx(tx: Prisma.TransactionClient, orgName: string): Promise<void>
{
  await tx.$queryRaw`SELECT 1 FROM cluster_tenants WHERE name = ${orgName} FOR UPDATE`;
  const org = await tx.clusterTenant.findUnique({ where: { name: orgName }, select: { seatCap: true } });
  if (!org || org.seatCap === null || org.seatCap === undefined)
  {
    return;
  }
  const count = await tx.orgMembership.count({ where: { clusterTenant: orgName, status: "Active" } });
  if (count >= org.seatCap)
  {
    throw new SeatCapExceededError();
  }
}

/**
 * Member-management router for an organisation (ClusterTenant): the authoritative
 * membership registry the silo projection repairer pulls (S2) and the org-admin
 * gate reads. Members here are `OrgMembership` rows.
 *
 * Zitadel seating (S3): on upsert the member is also granted the org project's
 * matching role (`owner`/`admin`/`member`) so their `sub` is authorizable at the
 * org's login surface — the fix for an invited member hitting `NO_TENANT`. The
 * grant is the LAST fallible step of the write transaction, mirroring the
 * org-create pattern: the DB row is written first, the IdP grant last, and a grant
 * failure rolls the DB write back so a membership never exists without its seat.
 * When the org is not yet Zitadel-provisioned (a `pending` org with null ids) the
 * membership is recorded locally and the grant is skipped.
 *
 * Mounted under `/api/v1/cluster-tenants/:name/members` and gated wholesale by
 * {@link _RequireOrgManager}: only a platform operator or an owner/admin of the
 * named org may read or mutate its membership.
 *
 * Last-Owner guardrail: an org must always retain ≥1 `Owner`. Both the role
 * change (POST demoting the sole Owner) and the removal (DELETE of the sole
 * Owner) are rejected with HTTP 409 so an org can never be orphaned.
 *
 * @param prisma        - Prisma client used for the membership reads/writes.
 * @param zitadelClient - Zitadel management client used to seat the member's project role.
 * @returns Configured Express router (mount under the org's `:name`).
 */
export function clusterTenantMembersRouter(prisma: PrismaClient, zitadelClient: ZitadelManagementClient): Router
{
  // `mergeParams` so the parent's `:name` (org) is visible on this child router,
  // both for the handlers and for the org-manager gate (which reads `req.params.name`).
  const router = Router({ mergeParams: true });

  const requireOrgManager = _RequireOrgManager(prisma);

  /** List the org's memberships (subject + role). */
  router.get("/", requireOrgManager, async function _listMembers(req: Request<{ name: string }>, res)
  {
    const orgName = req.params.name;
    if (!(await _orgExists(prisma, orgName)))
    {
      res.status(404).json({ error: "Cluster tenant not found", code: "CLUSTER_TENANT_NOT_FOUND" });
      return;
    }
    const rows = await prisma.orgMembership.findMany({
      where: { clusterTenant: orgName },
      orderBy: { createdAt: "asc" },
      select: { subject: true, role: true, status: true },
    });
    res.json(rows);
  });

  /**
   * Add or update a member (upsert on the unique [clusterTenant, subject]).
   *
   * Last-Owner guardrail: demoting the org's sole `Owner` to a lesser role is
   * rejected with 409 so the org always retains at least one Owner.
   */
  router.post("/", requireOrgManager, async function _upsertMember(req: Request<{ name: string }>, res)
  {
    const orgName = req.params.name;
    const body = (req.body ?? {}) as MemberWriteBody;

    // 1. Validate the body: a non-blank subject and a role in {Owner,Admin,Member}.
    const subject = typeof body.subject === "string" ? body.subject.trim() : "";
    if (!subject)
    {
      res.status(400).json({ error: "subject is required.", code: "VALIDATION_ERROR" });
      return;
    }
    if (!_isOrgRole(body.role))
    {
      res.status(400).json({ error: "role must be 'Owner', 'Admin', or 'Member'.", code: "VALIDATION_ERROR" });
      return;
    }
    const role = body.role;

    // 2. 404 when the org doesn't exist (never create a membership for a phantom org).
    if (!(await _orgExists(prisma, orgName)))
    {
      res.status(404).json({ error: "Cluster tenant not found", code: "CLUSTER_TENANT_NOT_FOUND" });
      return;
    }

    // 2b. Seat cap (S6): only a NEW member consumes a seat. Decide create-vs-update here; the
    //     actual reservation happens INSIDE the write tx (row-locked) so the cap is exact under
    //     concurrent adds. A role change on an existing member never reserves a seat, and the
    //     founding owner is seeded outside this route.
    const alreadyMember = await prisma.orgMembership.findUnique({
      where: { clusterTenant_subject: { clusterTenant: orgName, subject } },
      select: { subject: true },
    });

    // 3. Last-Owner guardrail: if this write would demote the org's sole Owner to a
    //    lesser role, reject — an org must always retain ≥1 Owner. Only relevant when
    //    the existing row is an Owner and the new role is not Owner.
    if (role !== "Owner")
    {
      const existing = await prisma.orgMembership.findUnique({
        where: { clusterTenant_subject: { clusterTenant: orgName, subject } },
        select: { role: true },
      });
      if (existing?.role === "Owner" && (await _ownerCount(prisma, orgName)) <= 1)
      {
        _log.warn({ orgName, subject }, "denied org-membership change: would demote the last Owner of the org");
        res.status(409).json({ error: "Cannot demote the last Owner of an organisation.", code: "LAST_OWNER" });
        return;
      }
    }

    // 4. Read the org's Zitadel ids so the seating grant can run inside the write tx.
    //    Null when the org is not yet Zitadel-provisioned (a `pending` org) — the
    //    membership is then recorded locally and the grant is skipped.
    const zitadelIds = await _readOrgZitadelIds(prisma, orgName);

    // 5. Reserve a seat (only for a new member) then upsert on the unique [clusterTenant, subject]
    //    and — when the org is provisioned — seat the member's Zitadel project role as the LAST
    //    fallible step, so a grant failure rolls the DB write back (no membership without its IdP
    //    seat). The seat reservation and the write share ONE transaction: the row lock it takes
    //    serialises concurrent adds so the cap is exact.
    let seated = false;
    let member: { subject: string; role: string };
    try
    {
      member = await prisma.$transaction(async function _upsertWithSeating(tx)
      {
        if (!alreadyMember)
        {
          await _reserveSeatInTx(tx, orgName);
        }
        const row = await tx.orgMembership.upsert({
          where: { clusterTenant_subject: { clusterTenant: orgName, subject } },
          create: { clusterTenant: orgName, subject, role },
          update: { role },
          select: { subject: true, role: true },
        });
        if (zitadelIds)
        {
          await zitadelClient.grantProjectRole(zitadelIds.orgId, zitadelIds.projectId, subject, _zitadelRoleKey(role));
          seated = true;
        }
        return row;
      });
    }
    catch (err)
    {
      if (err instanceof SeatCapExceededError)
      {
        _log.warn({ orgName, subject }, "denied org-membership add: organisation is at its seat cap");
        res.status(409).json({ error: "Organisation is at its seat cap; increase the seat cap to add more members.", code: _SEAT_CAP_EXCEEDED_CODE });
        return;
      }
      throw err;
    }

    if (!seated)
    {
      _log.info({ orgName, subject }, "recorded org membership without Zitadel seating (org not yet provisioned)");
    }

    // Response shape is stable + extended (weownai #30 is the client): the existing
    // { subject, role } fields are unchanged; `zitadelSeated` is additive.
    res.json({ ...member, zitadelSeated: seated });
  });

  /**
   * Remove a member from the org.
   *
   * Last-Owner guardrail: removing the org's sole `Owner` is rejected with 409.
   */
  router.delete("/:subject", requireOrgManager, async function _removeMember(req: Request<{ name: string; subject: string }>, res)
  {
    const orgName = req.params.name;
    const subject = req.params.subject;

    // 1. 404 when the org doesn't exist.
    if (!(await _orgExists(prisma, orgName)))
    {
      res.status(404).json({ error: "Cluster tenant not found", code: "CLUSTER_TENANT_NOT_FOUND" });
      return;
    }

    // 2. 404 when the member isn't in the org (nothing to remove).
    const existing = await prisma.orgMembership.findUnique({
      where: { clusterTenant_subject: { clusterTenant: orgName, subject } },
      select: { role: true },
    });
    if (!existing)
    {
      res.status(404).json({ error: "Membership not found", code: "MEMBERSHIP_NOT_FOUND" });
      return;
    }

    // 3. Last-Owner guardrail: refuse to remove the org's sole Owner — an org must
    //    always retain ≥1 Owner.
    if (existing.role === "Owner" && (await _ownerCount(prisma, orgName)) <= 1)
    {
      _log.warn({ orgName, subject }, "denied org-membership removal: would remove the last Owner of the org");
      res.status(409).json({ error: "Cannot remove the last Owner of an organisation.", code: "LAST_OWNER" });
      return;
    }

    // 4. Revoke the IdP grant BEFORE the local delete (#126 S4d). Offboarding must remove the
    //    Zitadel org membership too, or a removed member keeps a live grant at the org's login
    //    surface. The IdP call MUST succeed first: if it fails we return 502 and leave the local
    //    row, so the removal is retried — deleting the local row while the IdP grant survives
    //    would let the membership-adoption reconcile backstop RE-ADD the member (a resurrection
    //    loop). When the org is not yet Zitadel-provisioned (null ids) there is no grant to
    //    revoke, so the delete proceeds directly.
    const zitadelIds = await _readOrgZitadelIds(prisma, orgName);
    if (zitadelIds)
    {
      try
      {
        await zitadelClient.removeOrgMember(zitadelIds.orgId, subject);
      }
      catch (err)
      {
        _log.warn({ orgName, subject, err }, "failed to remove org member from Zitadel; leaving local row for retry (avoids reconcile resurrection)");
        res.status(502).json({ error: "Failed to revoke the member's IdP grant; please retry.", code: "UPSTREAM_ERROR" });
        return;
      }
    }

    // 5. Delete the membership row (only after the IdP grant is gone).
    await prisma.orgMembership.delete({
      where: { clusterTenant_subject: { clusterTenant: orgName, subject } },
    });
    res.json({ subject, status: "removed" });
  });

  /**
   * Suspend a member (#126): billing disabled their license, so the member is disabled in the org.
   * The IdP is deactivated FIRST (new logins blocked; the silo repairer then cuts live
   * sessions/devices and suspends their workspace pod), then the local status flips to Suspended.
   * A Suspended member FREES their seat — {@link _reserveSeatInTx} counts only Active memberships,
   * so a suspension lets a new member be added at what was the cap.
   *
   * Guards: 404 unknown org/member; refuse suspending the sole Active Owner (409 LAST_OWNER);
   * idempotent (already Suspended ⇒ 200 no-op).
   */
  router.post("/:subject/suspend", requireOrgManager, async function _suspendMember(req: Request<{ name: string; subject: string }>, res)
  {
    const orgName = req.params.name;
    const subject = req.params.subject;

    // 1. 404 when the org doesn't exist.
    if (!(await _orgExists(prisma, orgName)))
    {
      res.status(404).json({ error: "Cluster tenant not found", code: "CLUSTER_TENANT_NOT_FOUND" });
      return;
    }

    // 2. 404 when the member isn't in the org (nothing to suspend).
    const existing = await prisma.orgMembership.findUnique({
      where: { clusterTenant_subject: { clusterTenant: orgName, subject } },
      select: { role: true, status: true },
    });
    if (!existing)
    {
      res.status(404).json({ error: "Membership not found", code: "MEMBERSHIP_NOT_FOUND" });
      return;
    }

    // 3. Idempotent: an already-Suspended member is a 200 no-op (no IdP call, no status write).
    if (existing.status === "Suspended")
    {
      res.json({ subject, role: existing.role, status: existing.status });
      return;
    }

    // 4. Last-Owner guardrail: suspending the sole Active Owner would leave the org with no Owner
    //    able to administer it — refuse. (_ownerCount counts only Active Owners now.)
    if (existing.role === "Owner" && (await _ownerCount(prisma, orgName)) <= 1)
    {
      _log.warn({ orgName, subject }, "denied org-member suspend: would suspend the last Active Owner of the org");
      res.status(409).json({ error: "Cannot suspend the last Owner of an organisation.", code: "LAST_OWNER" });
      return;
    }

    // 5. Deactivate the IdP user FIRST (block new logins). Only after the block is in place do we
    //    flip the local status — a failure here returns 502 and leaves the status untouched so the
    //    suspension is retried (never a Suspended row whose IdP user can still log in). A pending
    //    org (null Zitadel ids) has no IdP user to deactivate, so the status flip proceeds directly.
    const zitadelIds = await _readOrgZitadelIds(prisma, orgName);
    if (zitadelIds)
    {
      try
      {
        await zitadelClient.deactivateUser(zitadelIds.orgId, subject);
      }
      catch (err)
      {
        _log.warn({ orgName, subject, err }, "failed to deactivate org member in Zitadel; leaving status untouched for retry");
        res.status(502).json({ error: "Failed to disable the member at the IdP; please retry.", code: "UPSTREAM_ERROR" });
        return;
      }
    }

    // 6. Flip the local status to Suspended (frees the seat via _reserveSeatInTx's Active-only count).
    const member = await prisma.orgMembership.update({
      where: { clusterTenant_subject: { clusterTenant: orgName, subject } },
      data: { status: "Suspended" },
      select: { subject: true, role: true, status: true },
    });
    res.json(member);
  });

  /**
   * Reactivate a suspended member (#126): billing re-enabled their license. Reactivation
   * re-occupies a seat, so it is only possible when the org is BELOW its Active-seat cap — the seat
   * is reserved via {@link _reserveSeatInTx} inside the write tx BEFORE the flip (throws
   * SeatCapExceededError ⇒ 409 SEAT_CAP_EXCEEDED). The IdP is reactivated only after the seat is
   * reserved, then the local status flips to Active (the silo repairer then clears the pod
   * suspension). Idempotent (already Active ⇒ 200 no-op, no seat consumed).
   *
   * Guards: 404 unknown org/member.
   */
  router.post("/:subject/reactivate", requireOrgManager, async function _reactivateMember(req: Request<{ name: string; subject: string }>, res)
  {
    const orgName = req.params.name;
    const subject = req.params.subject;

    // 1. 404 when the org doesn't exist.
    if (!(await _orgExists(prisma, orgName)))
    {
      res.status(404).json({ error: "Cluster tenant not found", code: "CLUSTER_TENANT_NOT_FOUND" });
      return;
    }

    // 2. 404 when the member isn't in the org (nothing to reactivate).
    const existing = await prisma.orgMembership.findUnique({
      where: { clusterTenant_subject: { clusterTenant: orgName, subject } },
      select: { role: true, status: true },
    });
    if (!existing)
    {
      res.status(404).json({ error: "Membership not found", code: "MEMBERSHIP_NOT_FOUND" });
      return;
    }

    // 3. Idempotent: an already-Active member is a 200 no-op (no seat reserved, no IdP call).
    if (existing.status === "Active")
    {
      res.json({ subject, role: existing.role, status: existing.status });
      return;
    }

    // 4. Reserve a seat (a Suspended → Active flip re-occupies one) inside the write tx so the cap
    //    is exact under concurrent reactivations. Reactivate the IdP user as the LAST fallible step
    //    (after the seat is reserved), so a failure rolls the whole tx back: neither the seat nor
    //    the status changes and the member stays suspended. A SeatCapExceededError becomes a 409;
    //    an IdP failure becomes a 502 — in both cases the status is untouched. A pending org (null
    //    Zitadel ids) has no IdP user to reactivate, so only the seat + status change.
    const zitadelIds = await _readOrgZitadelIds(prisma, orgName);
    let member: { subject: string; role: string; status: string };
    try
    {
      member = await prisma.$transaction(async function _reactivateWithSeat(tx)
      {
        // 4a. Reserve the Active seat first — reactivation must fail when the org is at its cap.
        await _reserveSeatInTx(tx, orgName);
        // 4b. Reactivate the IdP user (last fallible step) so its failure rolls the seat/flip back.
        if (zitadelIds)
        {
          await zitadelClient.reactivateUser(zitadelIds.orgId, subject);
        }
        // 4c. Flip the local status to Active.
        return tx.orgMembership.update({
          where: { clusterTenant_subject: { clusterTenant: orgName, subject } },
          data: { status: "Active" },
          select: { subject: true, role: true, status: true },
        });
      });
    }
    catch (err)
    {
      if (err instanceof SeatCapExceededError)
      {
        _log.warn({ orgName, subject }, "denied org-member reactivate: organisation is at its seat cap");
        res.status(409).json({ error: "Organisation is at its seat cap; increase the seat cap to reactivate this member.", code: _SEAT_CAP_EXCEEDED_CODE });
        return;
      }
      _log.warn({ orgName, subject, err }, "failed to reactivate org member at the IdP; leaving status untouched for retry");
      res.status(502).json({ error: "Failed to re-enable the member at the IdP; please retry.", code: "UPSTREAM_ERROR" });
      return;
    }
    res.json(member);
  });

  return router;
}
