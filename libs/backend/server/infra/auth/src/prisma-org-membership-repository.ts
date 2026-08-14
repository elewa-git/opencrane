import { OrgRole, type Prisma } from "@prisma/client";

import type { OrgMembershipRepository, OrgMembershipRow } from "./org-membership.types";

/**
 * Reads organisation memberships out of Postgres with Prisma.
 *
 * It runs one query and nothing else — who counts as an admin is decided by
 * {@link _ResolveOrgMembershipFacts}, and whether a route is allowed by the guards. The
 * query restricts to `Owner` and `Admin` roles and orders by organisation name so results
 * are stable between calls, and it re-checks each returned role, throwing if the database
 * ever hands back another one.
 *
 * Called by: constructed in libs/backend/server/iam/identity/main/src/oidc.service.ts
 * and handed to `OidcAuthServiceBase`, which calls it on every `/auth/me`.
 *
 * @implements {OrgMembershipRepository}
 */
export class PrismaOrgMembershipRepository implements OrgMembershipRepository
{
  /** Transaction-capable database surface supplied by the application composition root. */
  private readonly prisma: Prisma.TransactionClient;

  /** @param prisma - Application-owned Prisma client. */
  constructor(prisma: Prisma.TransactionClient)
  {
    this.prisma = prisma;
  }

  /**
   * @inheritdoc
   * @throws When Prisma cannot reach the database, and when a returned row carries a role
   *         other than `Owner` or `Admin` — a widened query must fail loudly rather than
   *         hand a `member` row to the resolver as if it granted authority.
   */
  async findAdminMemberships(subject: string): Promise<readonly OrgMembershipRow[]>
  {
    const rows = await this.prisma.orgMembership.findMany({
      where: { subject, role: { in: [OrgRole.Owner, OrgRole.Admin] } },
      select: { clusterTenant: true, role: true },
      orderBy: { clusterTenant: "asc" },
    });
    return rows.map(function _ToAuthorityBearingMembership(row)
    {
      if (row.role !== OrgRole.Owner && row.role !== OrgRole.Admin)
      {
        throw new Error("membership repository returned a non-authority role");
      }
      return { clusterTenant: row.clusterTenant, role: row.role };
    });
  }
}
