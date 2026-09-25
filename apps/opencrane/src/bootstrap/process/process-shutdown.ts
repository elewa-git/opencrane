/** One abort controller for the whole process, shared by every long-lived request. */
const _PROCESS_SHUTDOWN = new AbortController();

/** Signal passed to long-running streams so graceful shutdown need not wait out each stream's own time limit. */
export const _ProcessShutdownSignal = _PROCESS_SHUTDOWN.signal;

/** Start process shutdown before listeners and telemetry drain; calling it twice is safe. */
export function _BeginProcessShutdown(): void
{
	_PROCESS_SHUTDOWN.abort();
}
