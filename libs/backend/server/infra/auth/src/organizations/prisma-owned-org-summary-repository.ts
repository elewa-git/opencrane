import { OrgRole, type Prisma } from "@prisma/client";

import type { OwnedOrgSummaryRepository, OwnedOrgSummaryRow } from "./org-membership.types";

/**
 * Reads organisation membership rows for the `/auth/me` presentation summary.
 *
 * This repository does not authorize a product action. It loads the verified subject's rows and
 * projects owner and administrator labels for display; protected routes call the central
 * `AuthorizationAuthority` independently. The query includes every membership role so the storage
 * operation cannot be mistaken for an administrator permission check.
 *
 * Called by: constructed in libs/backend/server/iam/identity/main/src/auth/oidc.service.ts
 * and handed to `OidcAuthServiceBase`, which calls it on every `/auth/me`.
 *
 * @implements {OwnedOrgSummaryRepository}
 */
export class PrismaOwnedOrgSummaryRepository implements OwnedOrgSummaryRepository
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
   * @throws When Prisma cannot reach the database.
   */
  async findOwnedOrgSummaries(subject: string): Promise<readonly OwnedOrgSummaryRow[]>
  {
    const rows = await this.prisma.orgMembership.findMany({
      where: { subject },
      select: { clusterTenant: true, role: true },
      orderBy: { clusterTenant: "asc" },
    });
    return rows
      .filter(function _IsPresentedOwner(row) { return row.role === OrgRole.Owner || row.role === OrgRole.Admin; })
      .map(function _ToOwnedOrgSummary(row) { return { clusterTenant: row.clusterTenant, role: row.role as OwnedOrgSummaryRow["role"] }; });
  }
}
