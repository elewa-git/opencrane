/** The isolation levels PostgreSQL offers; spelled as Prisma's TransactionIsolationLevel values. */
export type PrismaUnitOfWorkIsolationLevel = "ReadUncommitted" | "ReadCommitted" | "RepeatableRead" | "Serializable";

/**
 * One complete idempotent operation over a fresh transaction attempt.
 *
 * The callback must not perform a network, filesystem, Kubernetes, provider, or other effect that
 * can survive a database rollback, because a retried conflict repeats it from its first read.
 */
export type PrismaUnitOfWorkWork<Transaction, Result> = (transaction: Transaction) => Promise<Result>;

/**
 * Declares how one unit of work opens and retries its Prisma transaction.
 *
 * Every field that changes concurrency behavior is explicit: there is no default isolation level,
 * so a reviewer always sees the one a boundary runs under.
 */
export interface PrismaUnitOfWorkPolicy
{
	/** Exact transaction isolation level; never inherited from the connection default. */
	readonly isolationLevel: PrismaUnitOfWorkIsolationLevel;
	/** Names the boundary in the exhaustion error; e.g. "steering request". */
	readonly operation: string;
	/** Total attempts including the first; defaults to 1 so nothing retries unless asked to. */
	readonly attemptLimit?: number;
	/** Prisma codes that prove the whole transaction rolled back; defaults to P2002 and P2034. */
	readonly retryableCodes?: ReadonlySet<string>;
	/** Extra domain-owned retry trigger for errors that are not Prisma conflict codes. */
	readonly isRetryable?: (error: unknown) => boolean;
	/** Maximum transaction runtime in milliseconds; Prisma's default when omitted. */
	readonly timeout?: number;
	/** Maximum wait for a connection in milliseconds; Prisma's default when omitted. */
	readonly maxWait?: number;
}

/**
 * Owns transaction opening and the bounded retry envelope for one declared unit of work.
 *
 * The boundary policy authorizes exactly one adapter of this contract to call `$transaction` for
 * every caller of the shared helper, so domain packages never own transaction plumbing themselves.
 */
export interface PrismaUnitOfWorkRunner<Transaction>
{
	/** Runs the complete idempotent operation, retrying only proven full rollbacks. */
	run<Result>(work: PrismaUnitOfWorkWork<Transaction, Result>, policy: PrismaUnitOfWorkPolicy): Promise<Result>;
}
