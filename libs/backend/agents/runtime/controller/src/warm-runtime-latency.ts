/** Full warm hand-off budget measured by the deterministic timing contract. */
export const __WARM_RUNTIME_CLAIM_BUDGET_MILLISECONDS = 1_000;
/** Pool-miss budget measured from first observation until a replacement becomes generic. */
export const __WARM_RUNTIME_POOL_MISS_BUDGET_MILLISECONDS = 5_000;

/** Throws when deterministic event times exceed the accepted warm-path budgets. */
export function __AssertWarmRuntimeTiming(events: { readonly admittedAt: number; readonly readyAt: number; readonly poolMissObservedAt?: number; readonly replacementReadyAt?: number }): void
{
	if (!Number.isSafeInteger(events.admittedAt) || !Number.isSafeInteger(events.readyAt) || events.readyAt < events.admittedAt || events.readyAt - events.admittedAt >= __WARM_RUNTIME_CLAIM_BUDGET_MILLISECONDS)
	{
		throw new Error("warm runtime claim exceeded its one-second contract");
	}
	const miss = events.poolMissObservedAt;
	const replacement = events.replacementReadyAt;
	if ((miss === undefined) !== (replacement === undefined))
	{
		throw new Error("warm runtime pool-miss timing requires both event times");
	}
	if (miss !== undefined && replacement !== undefined && (!Number.isSafeInteger(miss) || !Number.isSafeInteger(replacement) || replacement < miss || replacement - miss >= __WARM_RUNTIME_POOL_MISS_BUDGET_MILLISECONDS))
	{
		throw new Error("warm runtime pool miss exceeded its five-second contract");
	}
}
