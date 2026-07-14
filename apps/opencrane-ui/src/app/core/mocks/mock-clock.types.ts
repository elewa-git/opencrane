/** One deterministic task queued by the mock clock. */
export interface MockScheduledTask
{
	/** Monotonic task identifier used for cancellation. */
	id: number;
	/** Deterministic epoch time at which the task becomes runnable. */
	dueAt: number;
	/** Provider-owned mutation callback executed when time advances. */
	callback: () => void;
}
