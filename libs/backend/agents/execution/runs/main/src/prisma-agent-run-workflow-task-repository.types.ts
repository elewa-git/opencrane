/** Holds the bound receipt facts another run authority needs to derive a stable bootstrap reference. */
export interface AgentRunWorkflowTaskBoundReceipt
{
	/** Identifies the durable workflow task, or null before its engine receipt commits. */
	readonly taskId: string | null;
	/** Identifies the logical run that owns this task row. */
	readonly runId: string;
	/** Identifies the immutable run attempt that owns this task row. */
	readonly attempt: number;
	/** Identifies the silo that owns the task and its warm runtime reservation. */
	readonly siloId: string;
}
