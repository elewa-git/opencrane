/** One pending wait for a newer durable command or its bounded recovery deadline. */
interface _WakeWaiter
{
	/** Resolves the wait after a new in-process wake-up revision is observed. */
	resolve(): void;
}

/**
 * Disposable process-local wake-up fan-out for idle runtime streams.
 *
 * This is deliberately not an authority and holds neither command payloads nor run state. Postgres
 * remains the source of truth: a wake-up only asks a stream to perform its next fenced durable read,
 * while a bounded recovery wait prevents a dropped in-process signal from delaying that read forever.
 */
export class RuntimeCommandWakeup
{
	/** Monotonic local revision that closes the race between a durable read and waiter registration. */
	private revision = 0;
	/** Pending stream waits that may all re-check Postgres after one state-change hint. */
	private readonly waiters = new Set<_WakeWaiter>();

	/** Returns the current revision before a stream begins its durable command lookup. */
	currentRevision(): number
	{
		return this.revision;
	}

	/** Wakes all local streams after a candidate may have made a lifecycle command due. */
	wake(): void
	{
		this.revision += 1;
		for (const waiter of this.waiters) waiter.resolve();
		this.waiters.clear();
	}

	/** Waits for a newer revision, recovery timeout, or stream-abort signal without retaining command state. */
	waitForChange(observedRevision: number, recoveryMilliseconds: number, signal?: AbortSignal): Promise<void>
	{
		if (this.revision !== observedRevision || signal?.aborted === true) return Promise.resolve();
		const wakeup = this;
		return new Promise(function _wait(resolve)
		{
			const waiter: _WakeWaiter = { resolve: _resolve };
			const timer = setTimeout(_resolve, recoveryMilliseconds);
			function _resolve(): void
			{
				clearTimeout(timer);
				wakeup.waiters.delete(waiter);
				signal?.removeEventListener("abort", _resolve);
				resolve();
			}
			signal?.addEventListener("abort", _resolve, { once: true });
			// A wake-up can land after the first revision read but before this waiter exists.
			if (wakeup.revision !== observedRevision || signal?.aborted === true) _resolve();
			else wakeup.waiters.add(waiter);
		});
	}
}
