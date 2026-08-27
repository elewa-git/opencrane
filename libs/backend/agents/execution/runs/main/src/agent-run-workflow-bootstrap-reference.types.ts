/** Identifies the immutable facts that name one AgentRun workflow bootstrap. */
export interface AgentRunWorkflowBootstrapReferenceInput
{
	/** Identifies the durable workflow task receipt that may have started the Job. */
	readonly taskId: string;
	/** Identifies the logical run that owns the task. */
	readonly runId: string;
	/** Identifies the immutable attempt that owns the task. */
	readonly attempt: number;
	/** Names the silo whose runtime namespace may contain the Job. */
	readonly siloId: string;
	/** Identifies the service that selected the runtime profile. */
	readonly agentServiceId: string;
	/** Identifies the service revision admitted for this attempt. */
	readonly agentRevisionId: string;
	/** Identifies the frozen input snapshot used by the runtime. */
	readonly inputSnapshotDigest: string;
}
