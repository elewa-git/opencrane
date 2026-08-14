/**
 * How a conversation run is going, as far as the browser can tell.
 *
 * The distinction that matters is between `Failed` and `NeedsRecovery`. `Failed` means the run
 * ended and may be retried. `NeedsRecovery` means an external action was started and its outcome
 * is unknown — retrying could repeat it, so the UI must offer cancelling and nothing else.
 * `Interrupted` is not a failure at all: the run stopped because it needs input from the user.
 *
 * @see AgUiToolStatuses
 */
export enum AgUiRunStatuses
{
	/** No run has been observed. */
	Idle = "idle",
	/** The server stream started a run. */
	Running = "running",
	/** The authoritative stream completed a run successfully. */
	Succeeded = "succeeded",
	/** The authoritative stream ended because user input remains required. */
	Interrupted = "interrupted",
	/** An external action has an ambiguous outcome and the run can only be cancelled safely. */
	NeedsRecovery = "needs_recovery",
	/** The authoritative stream reported a run failure. */
	Failed = "failed",
	/** The authoritative stream reported cancellation. */
	Cancelled = "cancelled",
}

/** Why a run failed, in words the server has already made safe to display. */
export interface AgUiRunFailure
{
	/** Display-safe failure message. */
	readonly message: string;
	/** Optional server-selected failure code. */
	readonly code?: string;
}
