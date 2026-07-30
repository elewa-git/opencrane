/** Startup snapshot used to compose workload identity, dispatch, and worker routes. */
export interface InternalRuntimeConfig
{
	/** Whether the restricted artifact-preprocessor plane is enabled. */
	readonly artifactPreprocessorEnabled: boolean;
	/** Maximum accepted and promoted artifact-preprocessor output size. */
	readonly artifactPreprocessorMaximumOutputBytes: number;
	/** Namespace reserved for artifact-preprocessor Pods when enabled. */
	readonly artifactPreprocessorNamespace: string | undefined;
	/** Maximum time a controller claim remains valid. */
	readonly claimLeaseMilliseconds: number;
	/** Optional controller-selected replay route identifier. */
	readonly channelReplayRouteId: string | null;
	/** Maximum age of a runtime command before it is refused. */
	readonly commandTtlMilliseconds: number;
	/** Delay before recovering an unacknowledged runtime command. */
	readonly commandRecoveryMilliseconds: number;
	/** Namespace reserved for managed-agent runtime Jobs. */
	readonly managedRuntimeNamespace: string | undefined;
	/** Maximum retained published runtime outbox rows removed in one pass. */
	readonly outboxPruneBatchSize: number;
	/** Namespace reserved for personal-agent runtime Jobs. */
	readonly personalRuntimeNamespace: string | undefined;
	/** Retention period for delivered runtime outbox rows. */
	readonly publishedOutboxRetentionMilliseconds: number;
	/** Namespace containing the OpenCrane server and agent controller. */
	readonly serverNamespace: string;
	/** Lifetime of one durable runtime assignment. */
	readonly assignmentTtlMilliseconds: number;
}

/** Process-owned settings that shape the OpenCrane server lifecycle. */
export interface OpenCraneProcessConfig
{
	/** Namespace in which first-login workspaces are seeded. */
	readonly authWatchNamespace: string;
	/** Port exposed only to platform workloads. */
	readonly internalPort: number;
	/** Workload-facing identity and dispatch configuration. */
	readonly runtime: InternalRuntimeConfig;
	/** Public ingress-facing API port. */
	readonly publicPort: number;
	/** Whether the managed-agent schedule loop should run. */
	readonly schedulerEnabled: boolean;
	/** Delay between managed-agent schedule passes. */
	readonly schedulerIntervalMilliseconds: number;
}
