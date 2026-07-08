import { Router } from "express";
import type { Request } from "express";

import { Prisma } from "../../generated/prisma/index.js";
import type { PrismaClient } from "../../generated/prisma/index.js";
import type { ZitadelManagementClient } from "../../infra/zitadel/zitadel-client.types.js";
import { SeatCapExceededError, _SEAT_CAP_EXCEEDED_CODE, _orgExists, _readOrgZitadelIds, _reserveSeatInTx, _zitadelRoleKey } from "../cluster-tenant-members.js";
import type { InternalOrgMembershipView } from "./cluster-tenant-members.types.js";

/**
 * Internal (fleet ↔ silo) org-membership seam.
 *
 * The fleet registry owns the authoritative `OrgMembership` rows; a silo has no way to read
 * or write them across the DB boundary, so this endpoint pair is that seam (mirroring the
 * Tenant-projection channel). Decided for #126: a silo-side projection over a fleet internal
 * endpoint, NOT a ClusterTenant CR field.
 *
 *  - `GET  /:name/members`       — the projection SOURCE the silo repairer pulls (S2).
 *  - `POST /:name/members/adopt` — the write-through the silo uses to adopt a member on first
 *    login (S4): the fleet is the system-of-record, so a silo whose login proves org
 *    membership records it HERE (create-if-absent, never downgrade), and the projection
 *    repairer mirrors it straight back to the silo's local read-model. Without this, an
 *    adopted row written only to the silo would be reaped by the next projection sweep.
 *
 * Auth: mounted under `/api/internal/*`, which the fleet's `___AuthMiddleware` does NOT bypass
 * — a caller must present the shared `OPENCRANE_API_TOKEN` bearer (the silo's service
 * credential) — and is additionally NetworkPolicy-gated to platform pods at the network layer.
 *
 * @param prisma        - Fleet registry Prisma client.
 * @param zitadelClient - Zitadel management client used to seat an adopted member's project role.
 * @returns Configured Express router (mount at `/api/internal/cluster-tenants`).
 */
export function _RegisterInternalClusterTenantMembers(prisma: PrismaClient, zitadelClient: ZitadelManagementClient): Router
{
  const router = Router();

  /** List an org's authoritative memberships for the silo projection repairer. */
  router.get("/:name/members", async function _listMembers(req: Request<{ name: string }>, res)
  {
    const orgName = req.params.name;

    const org = await prisma.clusterTenant.findUnique({ where: { name: orgName }, select: { name: true } });
    if (!org)
    {
      res.status(404).json({ error: "Cluster tenant not found", code: "CLUSTER_TENANT_NOT_FOUND" });
      return;
    }

    const rows = await prisma.orgMembership.findMany({
      where: { clusterTenant: orgName },
      orderBy: { createdAt: "asc" },
      select: { subject: true, role: true, status: true },
    });

    const members: InternalOrgMembershipView[] = rows.map(function _toView(row)
    {
      return { subject: row.subject, role: row.role, status: row.status };
    });
    res.json({ clusterTenant: orgName, members });
  });

  /**
   * Adopt a member into the org on first login (S4 write-through). The silo calls this when a
   * per-org OIDC login proves org membership. Semantics differ deliberately from the public
   * admin upsert:
   *  - role is always `Member` (self-adoption never confers Owner/Admin);
   *  - **create-if-absent, never downgrade** — an existing Owner/Admin/Member row is returned
   *    untouched (so a re-login, or an owner logging in through the same client, is a no-op);
   *  - on a genuine create the member's `member` project role is seated in Zitadel (the same
   *    grant the admin path performs), as the last fallible step inside the write tx.
   */
  router.post("/:name/members/adopt", async function _adoptMember(req: Request<{ name: string }>, res)
  {
    const orgName = req.params.name;
    const body = (req.body ?? {}) as { subject?: unknown };
    const subject = typeof body.subject === "string" ? body.subject.trim() : "";

    if (!subject)
    {
      res.status(400).json({ error: "subject is required.", code: "VALIDATION_ERROR" });
      return;
    }
    if (!(await _orgExists(prisma, orgName)))
    {
      res.status(404).json({ error: "Cluster tenant not found", code: "CLUSTER_TENANT_NOT_FOUND" });
      return;
    }

    // Create-if-absent: an existing membership (any role) is returned untouched — adoption
    // must never downgrade an Owner/Admin who logs in through the same per-org client.
    const existing = await prisma.orgMembership.findUnique({
      where: { clusterTenant_subject: { clusterTenant: orgName, subject } },
      select: { role: true, status: true },
    });
    if (existing)
    {
      // A Suspended member has been disabled in the org (billing revoked their license). Adoption
      // must NOT silently re-admit them on a login attempt — refuse fail-closed (403). The
      // suspension is only lifted by the explicit reactivate route, never by re-login.
      if (existing.status === "Suspended")
      {
        res.status(403).json({ error: "Member is suspended in this organisation.", code: "MEMBER_SUSPENDED" });
        return;
      }
      res.json({ subject, role: existing.role, created: false, zitadelSeated: false });
      return;
    }

    const zitadelIds = await _readOrgZitadelIds(prisma, orgName);
    let seated = false;
    try
    {
      const row = await prisma.$transaction(async function _createWithSeating(tx)
      {
        // Seat cap (S6): a new adoption consumes a seat. Reserve it under a row lock INSIDE the
        // tx so concurrent first-logins can't over-cap; the silo treats the resulting 409 as a
        // fail-closed non-adopt (no local row, no workspace seed).
        await _reserveSeatInTx(tx, orgName);
        const created = await tx.orgMembership.create({
          data: { clusterTenant: orgName, subject, role: "Member" },
          select: { subject: true, role: true },
        });
        // Seat the project role as the LAST fallible step so a grant failure rolls the DB
        // write back (no membership without its IdP seat), mirroring the admin upsert.
        if (zitadelIds)
        {
          await zitadelClient.grantProjectRole(zitadelIds.orgId, zitadelIds.projectId, subject, _zitadelRoleKey("Member"));
          seated = true;
        }
        return created;
      });
      res.status(201).json({ ...row, created: true, zitadelSeated: seated });
    }
    catch (err)
    {
      if (err instanceof SeatCapExceededError)
      {
        res.status(409).json({ error: "Organisation is at its seat cap; increase the seat cap to add more members.", code: _SEAT_CAP_EXCEEDED_CODE });
        return;
      }
      // Lost a create race against a concurrent first-login for the same subject — the row
      // now exists, which is the desired end state; report it as already-adopted.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")
      {
        res.json({ subject, role: "Member", created: false, zitadelSeated: false });
        return;
      }
      throw err;
    }
  });

  return router;
}
