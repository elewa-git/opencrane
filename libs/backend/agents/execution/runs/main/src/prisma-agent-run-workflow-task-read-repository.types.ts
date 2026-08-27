/** Holds frozen identity evidence that chooses the task's runtime workload class. */
export interface AgentRunWorkflowSnapshotIdentity
{
	/** Identifies the person or managed service that owns this run. */
	readonly subjectId: string;
	/** Identifies the managed service, or is null for a personal run. */
	readonly managedServiceId: string | null;
	/** Limits how long the snapshot remains valid for workload assignment. */
	readonly trustedUntil: Date;
}
