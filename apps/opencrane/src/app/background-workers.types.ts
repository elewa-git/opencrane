/** Running process-owned loops that must stop before their database dependency is closed. */
export interface OpenCraneBackgroundWorkers
{
	/** Stop every interval, abort Kubernetes cleanup I/O, and drain its active pass. */
	stop(): Promise<void>;
}
