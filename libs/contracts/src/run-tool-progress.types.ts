/** Describes the latest governed tool invocation independently of the overall run state. */
export enum RunToolProgressPhases
{
	/** The invocation is preparing or ready for dispatch. */
	Queued = "queued",
	/** A worker holds the invocation or is reconciling its external outcome. */
	Running = "running",
	/** The tool result was received; the assistant may still need to produce its final answer. */
	ResultReceived = "result_received",
	/** The invocation awaits approval, failed, or requires recovery; this state grants no action. */
	NeedsAttention = "needs_attention",
}

/** Exposes only a tool phase to an authorized run reader, without tool identity or result content. */
export interface RunToolProgress
{
	/** Reports the latest invocation in the current run attempt. */
	readonly phase: RunToolProgressPhases;
}
