/** Creates a cleanup ledger that attempts registered actions once in reverse order. */
export function createAcquisitionLedger()
{
	const releases = [];
	let released = false;

	return {
		/** Registers cleanup before an acquisition that may create state and then reject. */
		acquire(name, release)
		{
			if (released)
			{
				throw new Error("Cannot acquire a resource after cleanup has started");
			}

			releases.push({ name, release });
		},
		/** Attempts every registered cleanup in reverse order and reports all failures together. */
		async releaseAll()
		{
			if (released)
			{
				return;
			}

			released = true;
			const failures = [];

			for (const entry of releases.reverse())
			{
				try
				{
					await entry.release();
				}
				catch (error)
				{
					failures.push(new Error(`${entry.name}: ${error.message}`, { cause: error }));
				}
			}

			if (failures.length > 0)
			{
				throw new AggregateError(failures, "Tier 2 resource cleanup failed");
			}
		}
	};
}
