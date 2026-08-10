/**
 * Request-bearing database check supplied by the composing application. The infrastructure
 * library depends only on this port, not the generated Prisma package or a raw query.
 */
export interface DbHealthProbeRepository
{
  /** Performs typed database I/O or rejects when the database is unavailable. */
  check: () => Promise<void>;
}

/** Selects one request-scoped database check. */
export interface DbHealthProbeUnitOfWork
{
  /** Performs typed database I/O or rejects when the database is unavailable. */
  check: () => Promise<void>;
}
