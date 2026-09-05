/** Owns the lifetime of the silo-local durable activation consumer. */
export interface ConversationComputerActivationWorker
{
	/** Stops delivery without acknowledging an outstanding event. */
	stop(): Promise<void>;
}
