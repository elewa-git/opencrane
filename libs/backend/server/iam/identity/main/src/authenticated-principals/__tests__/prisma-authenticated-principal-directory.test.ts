import { describe, expect, it, vi } from "vitest";

import { PrismaAuthenticatedPrincipalDirectoryRepository } from "../prisma-authenticated-principal-directory";

describe("PrismaAuthenticatedPrincipalDirectoryRepository", function _suite()
{
  it("resolves only the exact silo, issuer, and subject tuple", async function _test()
  {
    const findUnique = vi.fn().mockResolvedValue({ id: "principal-1", siloId: "silo-a" });
		const directory = new PrismaAuthenticatedPrincipalDirectoryRepository({ principal: { findUnique } } as never);

    await expect(directory.resolveAuthenticatedPrincipal("silo-a", "https://issuer.example", "subject-1"))
      .resolves.toEqual({ siloId: "silo-a", principalId: "principal-1" });
    expect(findUnique).toHaveBeenCalledWith({
      where: {
        siloId_issuer_subject: {
          siloId: "silo-a",
          issuer: "https://issuer.example",
          subject: "subject-1",
        },
      },
      select: { id: true, siloId: true },
    });
  });

  it("fails closed when no exact principal projection exists", async function _test()
  {
		const directory = new PrismaAuthenticatedPrincipalDirectoryRepository({
      principal: { findUnique: vi.fn().mockResolvedValue(null) },
    } as never);

    await expect(directory.resolveAuthenticatedPrincipal("silo-a", "https://issuer.example", "missing"))
      .resolves.toBeNull();
  });
});
