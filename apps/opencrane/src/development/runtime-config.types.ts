/** Configuration used by the Tier 2 runtime authorities without optional production services. */
export interface DevelopmentRuntimeConfig
{
	/** Time an admitted assignment remains valid. */
	readonly assignmentTtlMilliseconds: number;
	/** Time a runtime command remains eligible for delivery. */
	readonly commandTtlMilliseconds: number;
	/** Time after which an unacknowledged runtime command can be recovered. */
	readonly commandRecoveryMilliseconds: number;
	/** Namespace that represents the local server and controller identity. */
	readonly serverNamespace: string;
	/** Namespace that represents personal local runtime processes. */
	readonly personalRuntimeNamespace: string;
	/** Namespace that represents managed local runtime processes. */
	readonly managedRuntimeNamespace: string;
}
