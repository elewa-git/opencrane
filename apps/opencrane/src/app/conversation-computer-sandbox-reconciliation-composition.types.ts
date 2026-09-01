/**
 * Runs activation-stream replay and claim-status polling until process shutdown.
 *
 * Lifecycle shutdown calls this before the activation consumer and HistoryStore so no polling pass
 * can use a closed stream or leave a status observation in flight.
 */
export interface OpenCraneConversationComputerSandboxReconciliationWorker
{
	/** Stops the live stream reader and polling passes before its HistoryStore closes. */
	stop(): Promise<void>;
}
