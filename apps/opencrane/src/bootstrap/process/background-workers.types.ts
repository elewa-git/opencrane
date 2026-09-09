/** Running process-owned loops that must stop before their database dependency is closed. */
export interface OpenCraneBackgroundWorkers
{
	/** Stop every interval and drain durable tasks and provider work before database shutdown. */
	stop(): Promise<void>;
}
