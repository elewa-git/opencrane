import { OrgRole, type Prisma } from "@prisma/client";

import type { OrgMembershipRepository, OrgMembershipRow } from "./org-membership.types.js";

/**
 * Prisma adapter for organisation-membership facts used by the HTTP authentication seam.
 *
 * The adapter owns only database queries. Authentication and authorization rules stay in the
 * services and middleware that depend on its narrow repository contracts.
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

  /** @inheritdoc */
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
