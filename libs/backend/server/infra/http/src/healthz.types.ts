import type { PublicHealthReport } from "@opencrane/contracts";

/**
 * A database check that runs inside a transaction the caller has already opened.
 *
 * The HTTP library does not import Prisma, so the application supplies this repository port. The
 * Prisma boundary policy names its adapter so readiness uses request-bearing typed I/O rather than
 * treating a previously opened database connection as proof of current availability.
 *
 * Called by: apps/opencrane/src/infra/db/db.ts, where `_PrismaDbHealthProbeRepository` implements it.
 */
export interface DbHealthProbeRepository
{
	/** Performs typed database I/O or rejects when the database is unavailable. */
	check: () => Promise<void>;
}

/**
 * Opens a fresh transaction and runs typed database I/O for each database health check.
 *
 * Called by: `___CreatePublicHealthReportReader`, which uses this result as the API readiness gate.
 */
export interface DbHealthProbeUnitOfWork
{
	/** Performs typed database I/O or rejects when the database is unavailable. */
	check: () => Promise<void>;
}

/**
 * Reads the public-safe status of every user-visible OpenCrane service.
 *
 * The application owns probing and caching because it owns the external clients. The HTTP library
 * only needs the completed report and must never learn provider URLs, credentials, or topology.
 *
 * Called by: healthz.ts (`_CheckHealth`); implemented by the OpenCrane application health
 * composition under `apps/opencrane/src/infra/health`.
 */
export interface PublicHealthReportReader
{
	/** Returns a complete fixed service map; an unexpected rejection becomes the handler's fixed 503 fallback. */
	read: () => Promise<PublicHealthReport>;
}

/**
 * Structured logger for an unexpected aggregate health-reader failure.
 *
 * Called by: healthz.ts. Dependency-specific failures are logged by the application reader; this
 * port records only a reader defect that forces the fixed 503 fallback response.
 */
export interface PublicHealthRouteLogger
{
	/** Records the private error without adding it to the unauthenticated HTTP response. */
	readonly error: (fields: { readonly err: unknown }, message: string) => void;
}
