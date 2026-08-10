/** Process-owned abort controller shared by long-lived request compositions. */
const _PROCESS_SHUTDOWN = new AbortController();

/** Signal supplied to bounded streams so graceful shutdown does not wait for their duration fence. */
export const _ProcessShutdownSignal = _PROCESS_SHUTDOWN.signal;

/** Begin idempotent process shutdown before listeners and telemetry are drained. */
export function _BeginProcessShutdown(): void
{
	_PROCESS_SHUTDOWN.abort();
}
