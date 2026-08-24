/** Configuration used by the Tier 2 runtime authorities without optional production services. */
export interface DevelopmentRuntimeConfig
{
	/** Time a controller owns one uncommitted claim. */
	readonly claimLeaseMilliseconds: number;
	/** Time an admitted assignment remains valid. */
	readonly assignmentTtlMilliseconds: number;
	/** Time a runtime command remains eligible for delivery. */
	readonly commandTtlMilliseconds: number;
	/** Time after which an unacknowledged runtime command can be recovered. */
	readonly commandRecoveryMilliseconds: number;
	/** Time published controller outbox rows remain available for evidence. */
	readonly publishedOutboxRetentionMilliseconds: number;
	/** Maximum published outbox rows removed by one cleanup pass. */
	readonly outboxPruneBatchSize: number;
	/** Namespace that represents the local server and controller identity. */
	readonly serverNamespace: string;
	/** Namespace that represents personal local runtime processes. */
	readonly personalRuntimeNamespace: string;
	/** Namespace that represents managed local runtime processes. */
	readonly managedRuntimeNamespace: string;
}
