/** One pending wait for a newer durable command or its bounded recovery deadline. */
interface _WakeWaiter
{
	/** Resolves the wait after a new in-process wake-up revision is observed. */
	resolve(): void;
}

/**
 * Nudges streams that are sleeping inside this process, so a newly due command is read
 * promptly instead of on the next timer.
 *
 * It holds no commands and no run state, and grants nothing. Postgres decides what exists;
 * a wake-up only says "ask again now". That is why a lost wake-up is harmless: a stream
 * that misses one still re-reads when its recovery timeout expires, so the worst outcome
 * is a command arriving one recovery interval late, never one lost. It also only reaches
 * streams in the SAME process — with several replicas, other replicas' streams rely on
 * their own recovery timeout.
 *
 * Used by: `_RegisterInternalAgentRuntimeStream` in ./agent-runtime-stream.ts, which
 * creates one per router unless the app passes a shared instance.
 */
export class RuntimeCommandWakeup
{
	/** Monotonic local revision that closes the race between a durable read and waiter registration. */
	private revision = 0;
	/** Pending stream waits that may all re-check Postgres after one state-change hint. */
	private readonly waiters = new Set<_WakeWaiter>();

	/**
	 * The current counter value. Read it BEFORE the database lookup and pass it to
	 * {@link RuntimeCommandWakeup.waitForChange}; reading it afterwards would hide a wake-up
	 * that arrived during the lookup and cost a full recovery interval.
	 *
	 * @returns A counter that only ever increases within this process.
	 */
	currentRevision(): number
	{
		return this.revision;
	}

	/**
	 * Bump the counter and release every waiting stream in this process, so each re-reads
	 * Postgres. Cheap and safe to over-call: a stream that finds nothing due just sleeps
	 * again. The transport calls it only for an accepted external action, because waking on
	 * every accepted event would turn frequent message updates into a read storm.
	 */
	wake(): void
	{
		this.revision += 1;
		for (const waiter of this.waiters) waiter.resolve();
		this.waiters.clear();
	}

	/**
	 * Sleep until it is worth asking Postgres again. Returns as soon as any of these happens:
	 * the revision moved, the recovery timeout expired, or the stream was aborted.
	 *
	 * Returns immediately when the revision already moved or the signal is already aborted,
	 * which is what closes the gap between a stream reading the revision and registering its
	 * wait — a wake-up landing in between is not missed.
	 *
	 * @param observedRevision     - The value {@link RuntimeCommandWakeup.currentRevision}
	 *                               returned BEFORE the durable read; passing a stale value
	 *                               makes this return at once.
	 * @param recoveryMilliseconds - Longest sleep, in milliseconds; the safety net that makes
	 *                               a lost wake-up a delay rather than a hang.
	 * @param signal               - Aborted when the stream closes, so a dead connection does
	 *                               not hold a timer.
	 * @returns Resolves when it is time to re-read. It never says WHY it woke, because the
	 *          caller re-reads Postgres either way; it never rejects.
	 */
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
