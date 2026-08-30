import type { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { PrismaOwnedOrgSummaryRepository } from "../index";

describe("PrismaOwnedOrgSummaryRepository", function _Suite()
{
  it("projects owner and administrator labels from all membership rows", async function _FindsOwnedOrgSummaries()
  {
    const findMany = vi.fn().mockResolvedValue([
      { clusterTenant: "acme", role: "Owner" },
      { clusterTenant: "globex", role: "Member" },
    ]);
    const prisma = { orgMembership: { findMany } } as unknown as Prisma.TransactionClient;

    const repository = new PrismaOwnedOrgSummaryRepository(prisma);

    await expect(repository.findOwnedOrgSummaries("user-1")).resolves.toEqual([{ clusterTenant: "acme", role: "Owner" }]);
    expect(findMany).toHaveBeenCalledWith({
      where: { subject: "user-1" },
      select: { clusterTenant: true, role: true },
      orderBy: { clusterTenant: "asc" },
    });
  });
});
