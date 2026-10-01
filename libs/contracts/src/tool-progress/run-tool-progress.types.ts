/** Describes the latest governed tool invocation without exposing tool identity or content. */
export enum RunToolProgressPhases
{
	/** The invocation is preparing or ready for dispatch. */
	Queued = "queued",
	/** A worker holds the invocation or is reconciling its external outcome. */
	Running = "running",
	/** The tool result was received; the assistant may still need to produce its final answer. */
	ResultReceived = "result_received",
	/** The invocation needs attention; this state grants no action. */
	NeedsAttention = "needs_attention",
}

/** Exposes only the latest tool phase to an already authorized run reader. */
export interface RunToolProgress
{
	/** Reports the latest governed invocation in the current run attempt. */
	readonly phase: RunToolProgressPhases;
}
