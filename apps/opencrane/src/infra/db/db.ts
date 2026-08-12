import { Prisma, PrismaClient } from "@prisma/client";
import type { Logger } from "pino";

import type { DbHealthProbeRepository, DbHealthProbeUnitOfWork } from "@opencrane/backend/server/infra/http";

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
      await new _PrismaDbHealthProbeRepository(transaction).check();
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

/**
 * Creates and returns a configured PrismaClient instance.
 * @param log - Logger for query and error output
 * @returns A connected PrismaClient
 */
export function ___CreatePrismaClient(log: Logger): PrismaClient
{
  const prisma = new PrismaClient({
    log: [
      { emit: "event", level: "error" },
      { emit: "event", level: "warn" },
    ],
  });

  prisma.$on("error", (e) => {
    log.error({ message: e.message, target: e.target }, "prisma error");
  });

  prisma.$on("warn", (e) => {
    log.warn({ message: e.message, target: e.target }, "prisma warning");
  });

  return prisma;
}
