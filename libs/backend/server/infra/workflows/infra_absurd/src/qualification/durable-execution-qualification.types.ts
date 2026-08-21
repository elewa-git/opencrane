/**
 * Controls one bounded Gate D2 pickup-latency run against a deploy-verified silo.
 * The live wrapper supplies these values after it has selected the release and PgBouncer endpoint.
 */
export interface DurableExecutionQualificationOptions
{
	/** Application database URL routed through the silo PgBouncer pool. */
	readonly databaseUrl: string;
	/** Silo identity persisted in every qualification task. */
	readonly siloId: string;
	/** Idle worker polling interval under qualification. */
	readonly pollIntervalMs: number;
	/** Number of measured tasks after warm-up. */
	readonly sampleCount: number;
	/** Maximum acceptable p95 admission-to-handler latency. */
	readonly thresholdMs: number;
	/** Shared Absurd SDK pool ceiling across qualification queues. */
	readonly databasePoolSize: number;
}

/**
 * Reports whether every sample produced application-role connection evidence.
 * An unavailable observation fails Gate D2 instead of turning missing evidence into a zero count.
 */
export type DurableExecutionConnectionEvidence = Readonly<{
	/** Every expected connection observation completed. */
	available: true;
	/** Highest application-role connection count observed during the run. */
	peakConnections: number;
}> | Readonly<{
	/** At least one expected connection observation was unavailable. */
	available: false;
}>;

/**
 * Contains the credential-free evidence emitted by the live Gate D2 runner.
 * `passed` stays false unless both pickup latency and every connection-budget observation pass.
 */
export interface DurableExecutionQualificationResult
{
	/** Whether p95 latency and complete connection evidence remained within their ceilings. */
	readonly passed: boolean;
	/** Number of measured tasks included in the percentile distribution. */
	readonly sampleCount: number;
	/** Startup tasks excluded from the percentile distribution. */
	readonly warmupCount: number;
	/** Idle worker polling interval used for this run. */
	readonly pollIntervalMs: number;
	/** Highest p95 pickup latency that Gate D2 accepts. */
	readonly thresholdMs: number;
	/** Maximum connections available to the shared Absurd SDK pool. */
	readonly databasePoolSize: number;
	/** Allows the shared SDK pool plus the unit of work's single Prisma connection. */
	readonly connectionCeiling: number;
	/** Transport the deploy wrapper used to reach the silo PgBouncer service. */
	readonly transport: "kubectl-port-forward";
	/** Pickup-latency distribution after the startup samples were excluded. */
	readonly latencyMs: Readonly<{
		/** Nearest-rank median pickup latency. */
		p50: number;
		/** Nearest-rank p95 pickup latency used by the gate. */
		p95: number;
		/** Nearest-rank p99 pickup latency. */
		p99: number;
		/** Slowest measured pickup latency. */
		max: number;
	}>;
	/** Application-role connection observations used by the gate. */
	readonly connectionEvidence: DurableExecutionConnectionEvidence;
}
