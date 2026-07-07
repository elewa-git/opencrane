import { Router } from "express";
import { Prisma, type PrismaClient } from "../../generated/prisma/index.js";

import { _RequirePlatformOperator } from "@opencrane/infra-auth";
import { _DeriveOrgRedirectUri, _DeriveVanityRedirectUri } from "../../infra/zitadel/zitadel-client.js";
import type { ZitadelManagementClient } from "../../infra/zitadel/zitadel-client.types.js";
import { _log } from "../../log.js";
import type { ClusterTenantRow, ZitadelMemberAdoptionResult, ZitadelReconcileRequest, ZitadelReconcileSummary } from "./zitadel-reconcile.types.js";

/**
 * Whether a ClusterTenant row has a COMPLETE Zitadel provisioning — all four ids present.
 * A row missing any of orgId / clientId / appId / projectId is a reconcile candidate (it was
 * created before Zitadel was configured, or a provision half-failed). The reconcile is
 * idempotent off this predicate: a complete row makes no Zitadel call.
 *
 * @param row - The ClusterTenant row to inspect.
 * @returns True when every Zitadel id column is populated.
 */
function _IsZitadelComplete(row: ClusterTenantRow): boolean
{
  return Boolean(row.zitadelOrgId && row.zitadelClientId && row.zitadelAppId && row.zitadelProjectId);
}

/**
 * Re-provision a single ClusterTenant's Zitadel org and persist the ids in ONE transaction
 * (the external Zitadel call is the LAST fallible step, per the standing rule: a Prisma write
 * plus an external call go in one `$transaction` with the external call last, so a Zitadel
 * failure rolls the persist back and the DB never drifts).
 *
 * The org's master subject is the CT's `Owner` membership. When no Owner membership exists the
 * caller has already decided to skip the CT, so this helper assumes a non-empty `masterSubject`.
 *
 * @param prisma        - Prisma client (the persist runs inside its `$transaction`).
 * @param zitadelClient - The live Zitadel management client.
 * @param row           - The ClusterTenant row being reconciled.
 * @param masterSubject - The Owner subject granted `admin` on the (re-)provisioned org.
 * @param baseDomain    - Platform base domain used to derive the canonical redirect URI.
 */
async function _ReconcileOne(prisma: PrismaClient, zitadelClient: ZitadelManagementClient,
                             row: ClusterTenantRow, masterSubject: string, baseDomain: string): Promise<void>
{
  await prisma.$transaction(async function _persistAfterProvision(tx)
  {
    // The Zitadel call is the LAST fallible step: derive the redirect URIs as the create
    // handler does (canonical apex + the vanity callback when the org carries a vanity
    // domain) and re-provision. `provisionOrg` self-compensates on a mid-flight failure.
    const zitadel = await zitadelClient.provisionOrg({
      orgName: row.name,
      displayName: row.displayName,
      redirectUri: _DeriveOrgRedirectUri(row.name, baseDomain),
      ...(row.vanityDomain ? { vanityRedirectUri: _DeriveVanityRedirectUri(row.vanityDomain) } : {}),
      masterSubject,
    });
    await tx.clusterTenant.update({
      where: { name: row.name },
      data: { zitadelOrgId: zitadel.orgId, zitadelProjectId: zitadel.projectId, zitadelAppId: zitadel.appId, zitadelClientId: zitadel.clientId, zitadelRedirectUri: zitadel.redirectUri },
    });
  });
}

/**
 * Adopt an org's Zitadel Console users as local `Member` memberships (the #126 backstop).
 *
 * A user invited directly in the Zitadel Console never hits the app's member-add route, so
 * they hold an IdP grant but no `OrgMembership` row — the org-admin surface can't see them.
 * This lists the org's Zitadel user pool and, for every subject with NO existing membership,
 * creates a `Member` row. It is **create-if-absent**: an existing membership (of ANY role) is
 * left untouched, so an Owner/Admin is NEVER downgraded to Member. A concurrent create that
 * loses the unique race (P2002) is tolerated and counted as a skip.
 *
 * @param prisma        - Prisma client for the membership reads/writes.
 * @param zitadelClient - Live Zitadel client used to list the org's users.
 * @param orgName       - ClusterTenant (org) name — the membership `clusterTenant`.
 * @param zitadelOrgId  - Zitadel Organization id whose user pool is listed.
 * @returns The per-org `{ adopted, skipped }` counts.
 */
async function _AdoptOrgMembers(prisma: PrismaClient, zitadelClient: ZitadelManagementClient,
                                orgName: string, zitadelOrgId: string): Promise<ZitadelMemberAdoptionResult>
{
  const users = await zitadelClient.listOrgUsers(zitadelOrgId);
  let adopted = 0;
  let skipped = 0;
  for (const user of users)
  {
    // Create-if-absent: never overwrite an existing membership, so an Owner/Admin invited via
    // the Console (or seeded locally) keeps their role rather than being reset to Member.
    const existing = await prisma.orgMembership.findUnique({
      where: { clusterTenant_subject: { clusterTenant: orgName, subject: user.subject } },
      select: { subject: true },
    });
    if (existing)
    {
      skipped += 1;
      continue;
    }
    try
    {
      await prisma.orgMembership.create({ data: { clusterTenant: orgName, subject: user.subject, role: "Member" } });
      adopted += 1;
    }
    catch (err)
    {
      // Tolerate a lost unique race (P2002) — the row now exists, so treat it as a skip.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")
      {
        skipped += 1;
        continue;
      }
      throw err;
    }
  }
  return { name: orgName, adopted, skipped };
}

/**
 * Run one idempotent Zitadel reconcile/backfill pass (S3d + the #126 adoption backstop).
 *
 * For every ClusterTenant in scope whose Zitadel ids are incomplete (missing orgId OR clientId
 * OR appId OR projectId), it re-runs `provisionOrg` (master subject = the CT's `Owner`
 * membership) and persists the ids transactionally (external call LAST). It is **idempotent**:
 * a fully-provisioned CT is skipped with no Zitadel call, and re-running it on an already-healed
 * fleet is a no-op. A second pass then adopts Console-invited users as `Member` memberships.
 *
 * Failure isolation: a per-CT failure (no Owner → `skipped: no-owner`; a `provisionOrg`/persist
 * throw → `failed`; an adoption throw → `memberAdoptionFailed`) NEVER aborts the run — each
 * outcome is collected and the scan continues. Every skip/fail is structured-logged.
 *
 * Shared by the on-demand reconcile route and the periodic reconcile loop, so both surfaces
 * run the exact same pass.
 *
 * @param prisma        - Prisma client used to read the fleet + persist the reconciled ids.
 * @param zitadelClient - The live Zitadel management client used to (re-)provision orgs.
 * @param scope         - The ClusterTenants to reconcile; omitted → the whole fleet (createdAt asc).
 * @returns The run summary (reconciled / skipped / failed + the adoption-pass outcomes).
 */
export async function _RunZitadelReconcile(prisma: PrismaClient, zitadelClient: ZitadelManagementClient,
                                           scope?: ClusterTenantRow[]): Promise<ZitadelReconcileSummary>
{
  const baseDomain = process.env.PLATFORM_BASE_DOMAIN?.trim() ?? "";

  // 1. Resolve the scope: the caller-provided rows, or the whole fleet.
  const rows = scope ?? await prisma.clusterTenant.findMany({ orderBy: { createdAt: "asc" } });

  const summary: ZitadelReconcileSummary = { reconciled: [], skipped: [], failed: [], memberAdoption: [], memberAdoptionFailed: [] };

  // 2. Walk every candidate. Each CT lands in exactly one bucket; a per-CT failure is
  //    collected and the loop continues so one bad org never strands the rest.
  for (const row of rows)
  {
    // 2a. Idempotency: a fully-provisioned CT makes no Zitadel call.
    if (_IsZitadelComplete(row))
    {
      summary.skipped.push({ name: row.name, reason: "already-provisioned" });
      continue;
    }

    // 2b. The master subject is the CT's Owner membership; with no Owner there is no
    //     identity to grant `admin`, so skip (reported) rather than guess.
    const owner = await prisma.orgMembership.findFirst({ where: { clusterTenant: row.name, role: "Owner" } });
    if (!owner)
    {
      _log.warn({ orgName: row.name }, "zitadel reconcile: skipped — no Owner membership to use as the org master subject");
      summary.skipped.push({ name: row.name, reason: "no-owner" });
      continue;
    }

    // 2c. (Re-)provision + persist transactionally (external LAST). A throw here is this
    //     CT's failure alone — collect it and move on.
    try
    {
      await _ReconcileOne(prisma, zitadelClient, row, owner.subject, baseDomain);
      _log.info({ orgName: row.name }, "zitadel reconcile: re-provisioned org and persisted ids");
      summary.reconciled.push(row.name);
    }
    catch (err)
    {
      const message = err instanceof Error ? err.message : String(err);
      _log.error({ err, orgName: row.name }, "zitadel reconcile: provision/persist FAILED for this org (continuing with the rest)");
      summary.failed.push({ name: row.name, error: message });
    }
  }

  // 3. Membership-adoption backstop (#126): adopt Console-invited users who never hit the
  //    member-add route. Re-read the rows so any org just healed in pass 1 carries its freshly
  //    persisted orgId/projectId. For every fully-provisioned org (both ids set) list its
  //    Zitadel users and create a `Member` membership for each subject with none. Best-effort
  //    per org — a `listOrgUsers`/adopt failure for one org is collected and does not abort.
  const names = rows.map(function _name(row) { return row.name; });
  const fresh = await prisma.clusterTenant.findMany({ where: { name: { in: names } } });
  for (const row of fresh)
  {
    if (!row.zitadelOrgId || !row.zitadelProjectId)
    {
      continue;
    }
    try
    {
      const result = await _AdoptOrgMembers(prisma, zitadelClient, row.name, row.zitadelOrgId);
      _log.info({ orgName: row.name, adopted: result.adopted, skipped: result.skipped }, "zitadel reconcile: member-adoption pass complete for org");
      summary.memberAdoption.push(result);
    }
    catch (err)
    {
      const message = err instanceof Error ? err.message : String(err);
      _log.error({ err, orgName: row.name }, "zitadel reconcile: member-adoption FAILED for this org (continuing with the rest)");
      summary.memberAdoptionFailed.push({ name: row.name, error: message });
    }
  }

  _log.info({ reconciled: summary.reconciled.length, skipped: summary.skipped.length, failed: summary.failed.length, adopted: summary.memberAdoption.reduce(function _sum(n, r) { return n + r.adopted; }, 0), adoptFailed: summary.memberAdoptionFailed.length }, "zitadel reconcile: run complete");
  return summary;
}

/**
 * Superadmin-gated router for the idempotent Zitadel reconcile/backfill (S3d).
 *
 * A thin HTTP wrapper over {@link _RunZitadelReconcile} (the same pass the periodic loop runs):
 * it resolves the request scope (single named CT → 404 when absent; otherwise the whole fleet)
 * and always returns 200 with the full run summary — per-CT failures are collected, never fatal.
 *
 * Mounted at `/api/v1/admin/zitadel` (sibling of the SA-key router), behind
 * {@link _RequirePlatformOperator}. Only the multi-tenant path constructs the Zitadel client,
 * so it is mounted only there (see `routes.ts`).
 *
 * @param prisma        - Prisma client used to read the fleet + persist the reconciled ids.
 * @param zitadelClient - The live Zitadel management client used to (re-)provision orgs.
 * @returns Configured Express router.
 */
export function zitadelReconcileRouter(prisma: PrismaClient, zitadelClient: ZitadelManagementClient): Router
{
  const router = Router();

  router.use(_RequirePlatformOperator());

  /**
   * Reconcile incomplete Zitadel orgs across the fleet (or a single CT when `{ name }` is given).
   * Always 200 with a `{ reconciled, skipped, failed }` summary; per-CT failures are collected.
   */
  router.post("/reconcile", async function _reconcile(req, res)
  {
    const body = (req.body ?? {}) as ZitadelReconcileRequest;

    // 1. Resolve the scope: a single named CT (404 when absent) or the whole fleet.
    let scope: ClusterTenantRow[] | undefined;
    if (typeof body.name === "string" && body.name.trim())
    {
      const row = await prisma.clusterTenant.findUnique({ where: { name: body.name.trim() } });
      if (!row)
      {
        res.status(404).json({ error: "Cluster tenant not found", code: "CLUSTER_TENANT_NOT_FOUND" });
        return;
      }
      scope = [row];
    }

    // 2. Run the shared reconcile pass and return its summary verbatim.
    const summary = await _RunZitadelReconcile(prisma, zitadelClient, scope);
    res.status(200).json(summary);
  });

  return router;
}
