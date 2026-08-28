/** Reports the retry decision shared by worker failures and controller recovery. */
export interface ArtifactPreprocessFailureTransition
{
	/** True when the current delivery exhausted the job's bounded delivery count. */
	readonly terminal: boolean;
	/** Database-owned instant when another delivery may be claimed, or null after exhaustion. */
	readonly nextAttemptAt: Date | null;
}
