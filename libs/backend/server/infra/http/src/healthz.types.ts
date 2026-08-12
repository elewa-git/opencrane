/**
 * A database check that runs inside a transaction the caller has already opened.
 *
 * This library never imports the generated Prisma package, so the composing application supplies the
 * check. This interface and {@link DbHealthProbeUnitOfWork} below have identical members on purpose:
 * this one is implemented by the class that queries INSIDE a transaction, while the other OPENS the
 * transaction and calls it. Both are live in apps/opencrane/src/infra/db/db.ts, so pick by which
 * side you are writing.
 *
 * Called by: apps/opencrane/src/infra/db/db.ts, where `_PrismaDbHealthProbeRepository` implements it
 * and runs a single indexed `findFirst`.
 */
export interface DbHealthProbeRepository
{
  /** Performs typed database I/O or rejects when the database is unavailable. */
  check: () => Promise<void>;
}

/**
 * Opens one transaction per health check and runs the check inside it.
 *
 * This is the port `_CheckDbHealth` takes: the `/healthz` handler needs a single call it can await,
 * and the composing app decides how the transaction is opened. Same members as
 * {@link DbHealthProbeRepository} above — the difference is who owns the transaction.
 *
 * Called by: healthz.ts (`_CheckDbHealth`); implemented and composed in
 * apps/opencrane/src/infra/db/db.ts (`_PrismaDbHealthProbeUnitOfWork`, returned by
 * `___CreateDbHealthProbe`).
 */
export interface DbHealthProbeUnitOfWork
{
  /** Performs typed database I/O or rejects when the database is unavailable. */
  check: () => Promise<void>;
}
