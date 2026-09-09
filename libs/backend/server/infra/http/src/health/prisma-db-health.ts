import { Prisma, PrismaClient } from "@prisma/client";

import type { DbHealthProbeRepository, DbHealthProbeUnitOfWork } from "../healthz.types";

/** Checks the database answers, for the readiness route, through Prisma's typed client rather than raw SQL. */
class _PrismaDbHealthProbeRepository implements DbHealthProbeRepository
{
  public constructor(private readonly _prisma: Prisma.TransactionClient) {}

  /** Send one real query through the typed client instead of raw Prisma access. */
  public async check(): Promise<void>
  {
    await this._prisma.auditEntry.findFirst({ select: { id: true } });
  }
}

/** Opens a fresh transaction for each database readiness check. */
class _PrismaDbHealthProbeUnitOfWork implements DbHealthProbeUnitOfWork
{
  public constructor(private readonly _prisma: PrismaClient) {}

  /** @inheritdoc */
  public async check(): Promise<void>
  {
    await this._prisma.$transaction(async function _check(transaction: Prisma.TransactionClient)
    {
      const repository = new _PrismaDbHealthProbeRepository(transaction);
      await repository.check();
    });
  }
}

/**
 * Compose the typed, request-bearing database readiness probe.
 * @param prisma - Canonical product-authority database client.
 * @returns Database health port used by the public health route.
 */
export function ___CreateDbHealthProbe(prisma: PrismaClient): DbHealthProbeUnitOfWork
{
  return new _PrismaDbHealthProbeUnitOfWork(prisma);
}
