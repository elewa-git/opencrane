import { type Prisma, type PrismaClient } from "@prisma/client";

import { type AuthenticatedPrincipal, type AuthenticatedPrincipalDirectory } from "./authenticated-principal-directory.types";
import { PrismaAuthenticatedPrincipalDirectoryRepository } from "./prisma-authenticated-principal-directory";

/**
 * Resolves a verified identity tuple through a read transaction.
 * App route composition and `Tier3DevelopmentAuthService` use this adapter when no wider identity
 * transaction already exists.
 */
export class PrismaAuthenticatedPrincipalDirectoryUnitOfWork implements AuthenticatedPrincipalDirectory
{
  /** Root product-authority client used only to open the identity read transaction. */
  private readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient)
  {
    this.prisma = prisma;
  }

  /** @inheritdoc */
  async resolveAuthenticatedPrincipal(siloId: string, issuer: string, subject: string): Promise<AuthenticatedPrincipal | null>
  {
    return this.prisma.$transaction(async function _resolve(transaction: Prisma.TransactionClient)
    {
      const repository = new PrismaAuthenticatedPrincipalDirectoryRepository(transaction);
      return repository.resolveAuthenticatedPrincipal(siloId, issuer, subject);
    });
  }
}
