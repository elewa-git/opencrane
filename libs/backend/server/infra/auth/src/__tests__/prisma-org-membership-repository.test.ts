import type { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { PrismaOrgMembershipRepository } from "../index";

describe("PrismaOrgMembershipRepository", function _Suite()
{
  it("reads only owner and admin membership rows in stable organisation order", async function _FindsAdminMemberships()
  {
    const findMany = vi.fn().mockResolvedValue([{ clusterTenant: "acme", role: "Owner" }]);
    const prisma = { orgMembership: { findMany } } as unknown as Prisma.TransactionClient;

    const repository = new PrismaOrgMembershipRepository(prisma);

    await expect(repository.findAdminMemberships("user-1")).resolves.toEqual([{ clusterTenant: "acme", role: "Owner" }]);
    expect(findMany).toHaveBeenCalledWith({
      where: { subject: "user-1", role: { in: ["Owner", "Admin"] } },
      select: { clusterTenant: true, role: true },
      orderBy: { clusterTenant: "asc" },
    });
  });
});
