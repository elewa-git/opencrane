import type { PublicHealthReport, PublicHealthServiceNames } from "@opencrane/contracts";

/**
 * Structured private logger used when a dependency probe fails.
 *
 * Called by: the public health aggregation boundary. The logger receives only a fixed public service
 * name and the error; probe URLs, headers, and credentials are never added as fields.
 */
export interface PublicHealthLogger
{
	/** Records an unavailable service result for operator diagnosis. */
	readonly warn: (fields: { readonly err: unknown; readonly healthService: PublicHealthServiceNames }, message: string) => void;
}

/**
 * Checks one service without carrying its failure details into the public response.
 *
 * Called by: the public health transport probes and cached aggregation boundary.
 */
export interface PublicHealthProbe
{
	/** Resolves when the service boundary answers and rejects for every unavailable outcome. */
	readonly check: () => Promise<void>;
}

/**
 * Clock used to keep the unauthenticated health route from amplifying dependency traffic.
 *
 * Called by: the cached aggregation boundary and its deterministic expiry tests.
 */
export interface PublicHealthClock
{
	/** Returns epoch time in milliseconds; tests replace it to control cache expiry. */
	readonly nowEpochMilliseconds: () => number;
}

/**
 * Supplies the probes and cache policy for the public health report reader.
 *
 * Non-null probes represent required configured services. The nullable channel probe preserves the
 * difference between a disabled optional capability and a configured service that failed its check.
 * Called by: `_CreatePublicHealthReportReader` after process composition has frozen every target.
 */
export interface PublicHealthReaderDependencies
{
	/** Required product database probe that controls API readiness. */
	readonly database: PublicHealthProbe;
	/** Required model-routing probe. */
	readonly models: PublicHealthProbe;
	/** Required memory-gateway probe. */
	readonly memory: PublicHealthProbe;
	/** Required immutable-file service probe. */
	readonly files: PublicHealthProbe;
	/** Optional live-channel service probe; null means intentionally disabled. */
	readonly channels: PublicHealthProbe | null;
	/** Structured private logger for collapsed dependency failures. */
	readonly logger: PublicHealthLogger;
	/** Clock used to expire one shared report. */
	readonly clock: PublicHealthClock;
	/** Maximum time one completed or in-flight report may be reused. */
	readonly cacheMilliseconds: number;
}

/**
 * One cached or in-flight report shared by concurrent public health requests.
 *
 * Called by: the app-owned health reader; this state is process-local and never persisted.
 */
export interface PublicHealthCacheEntry
{
	/** Epoch time after which a request must start fresh checks. */
	readonly expiresAtEpochMilliseconds: number;
	/** Shared report promise, including the in-flight first read. */
	readonly report: Promise<PublicHealthReport>;
}
