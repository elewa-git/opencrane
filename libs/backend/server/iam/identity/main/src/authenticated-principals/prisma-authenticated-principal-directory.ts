import { type Prisma } from "@prisma/client";

import { type AuthenticatedPrincipal, type AuthenticatedPrincipalDirectory } from "./authenticated-principal-directory.types";

/** Resolves verified OIDC coordinates against the local Principal projection. */
export class PrismaAuthenticatedPrincipalDirectoryRepository implements AuthenticatedPrincipalDirectory
{
  /** Product authority used only for the exact principal lookup. */
  private readonly prisma: Prisma.TransactionClient;

  constructor(prisma: Prisma.TransactionClient)
  {
    this.prisma = prisma;
  }

  /** @inheritdoc */
  async resolveAuthenticatedPrincipal(siloId: string, issuer: string, subject: string): Promise<AuthenticatedPrincipal | null>
  {
    const principal = await this.prisma.principal.findUnique({
      where: {
        siloId_issuer_subject: {
          siloId,
          issuer,
          subject,
        },
      },
      select: {
        id: true,
        siloId: true,
      },
    });
    if (principal === null)
    {
      return null;
    }
    return {
      siloId: principal.siloId,
      principalId: principal.id,
    };
  }
}
