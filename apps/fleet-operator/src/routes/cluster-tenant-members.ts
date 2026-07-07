import { Router } from "express";
import type { Request } from "express";
import type { PrismaClient } from "../generated/prisma/index.js";

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
 * Count the org's current `Owner` memberships — the guardrail input for the
 * last-Owner invariant (an org must always retain at least one Owner).
 *
 * @param prisma - Prisma client for the count.
 * @param orgName - ClusterTenant (org) name.
 * @returns The number of `Owner` memberships in the org.
 */
async function _ownerCount(prisma: PrismaClient, orgName: string): Promise<number>
{
  return prisma.orgMembership.count({ where: { clusterTenant: orgName, role: "Owner" } });
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
      select: { subject: true, role: true },
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

    // 5. Upsert on the unique [clusterTenant, subject] and — when the org is provisioned —
    //    seat the member's Zitadel project role as the LAST fallible step, so a grant
    //    failure rolls the DB write back (no membership without its IdP seat).
    let seated = false;
    const member = await prisma.$transaction(async function _upsertWithSeating(tx)
    {
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

    // 4. Delete the membership row.
    await prisma.orgMembership.delete({
      where: { clusterTenant_subject: { clusterTenant: orgName, subject } },
    });
    res.json({ subject, status: "removed" });
  });

  return router;
}
