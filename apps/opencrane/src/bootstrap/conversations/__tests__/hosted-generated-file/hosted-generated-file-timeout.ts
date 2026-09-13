/** Build one request signal that preserves an upstream cancellation and enforces a local deadline. */
export function __HostedGeneratedFileRequestSignal(timeoutMilliseconds: number, upstream?: AbortSignal | null): AbortSignal
{
	if (!Number.isSafeInteger(timeoutMilliseconds) || timeoutMilliseconds < 1)
		throw new Error("Hosted qualification request timeout must be a positive integer");
	const deadline = AbortSignal.timeout(timeoutMilliseconds);
	return upstream === undefined || upstream === null ? deadline : AbortSignal.any([upstream, deadline]);
}

/** Return the positive milliseconds left in one bounded operation. */
export function __HostedGeneratedFileRemaining(deadlineEpochMilliseconds: number, operation: string): number
{
	const remaining = deadlineEpochMilliseconds - Date.now();
	if (remaining < 1)
		throw new Error(`Hosted ${operation} did not complete before timeout`);
	return remaining;
}

/** Yield within an operation without sleeping beyond its remaining deadline. */
export function __HostedGeneratedFileDelay(milliseconds: number, deadlineEpochMilliseconds: number, operation: string): Promise<void>
{
	return new Promise(function _Wait(resolve) { setTimeout(resolve, Math.min(milliseconds, __HostedGeneratedFileRemaining(deadlineEpochMilliseconds, operation))); });
}
