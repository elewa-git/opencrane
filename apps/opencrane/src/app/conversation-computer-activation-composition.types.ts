/**
 * Owns the shutdown boundary for the app-composed ConversationComputer activation subscription.
 *
 * Lifecycle shutdown calls this before closing KurrentDB, so an unfinished delivery is eligible for
 * redelivery instead of being acknowledged by a closed dependency.
 */
export interface OpenCraneConversationComputerActivationWorker
{
	/** Closes the persistent consumer and waits for its listener to finish without acknowledging unfinished deliveries. */
	stop(): Promise<void>;
}
