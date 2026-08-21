/** Inputs for one engine-specific live pickup-latency qualification. */
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

/** Application-role connection evidence collected without broader database authority. */
export type DurableExecutionConnectionEvidence = Readonly<{
	available: true;
	peakConnections: number;
}> | Readonly<{
	available: false;
}>;

/** Safe JSON report emitted by the live qualification runner. */
export interface DurableExecutionQualificationResult
{
	readonly passed: boolean;
	readonly sampleCount: number;
	readonly warmupCount: number;
	readonly pollIntervalMs: number;
	readonly thresholdMs: number;
	readonly databasePoolSize: number;
	/** Maximum tagged connections the qualification may open through PgBouncer. */
	readonly connectionCeiling: number;
	readonly transport: "kubectl-port-forward";
	readonly latencyMs: Readonly<{
		p50: number;
		p95: number;
		p99: number;
		max: number;
	}>;
	readonly connectionEvidence: DurableExecutionConnectionEvidence;
}
