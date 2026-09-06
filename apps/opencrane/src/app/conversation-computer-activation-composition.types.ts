import type { ConversationComputerActivationConsumerHealth, ConversationComputerActivationResubscribePolicy } from "@opencrane/backend/server/conversations";

/**
 * Owns the lifetime of this replica's competing consumer on the silo activation queue.
 *
 * Called by: apps/opencrane/src/app/lifecycle.ts during the `drain_workers` shutdown stage.
 */
export interface ConversationComputerActivationWorker
{
	/**
	 * Stops pulling deliveries, lets the in-flight one settle, then closes the subscription.
	 * @throws {Error} When the consumer had already used its reopen budget, so shutdown exits non-zero.
	 */
	stop(): Promise<void>;
}

/** Adds the health snapshot to the worker handle the composition returns. */
export interface ConversationComputerActivationWorkerHandle extends ConversationComputerActivationWorker
{
	/** Reads the consumer's current health snapshot. */
	health(): ConversationComputerActivationConsumerHealth;
}

/** Seams the composition exposes so tests can shorten waits and observe the give-up reaction. */
export interface ConversationComputerActivationWorkerOptions
{
	/** Replaces the process reaction to an exhausted reopen budget; defaults to sending this process SIGTERM. */
	readonly onExhausted?: () => void;
	/** Overrides part of the default reopen policy. */
	readonly resubscribe?: Partial<ConversationComputerActivationResubscribePolicy>;
	/** Replaces the clock wait between attempts and before a delivery retry. */
	readonly wait?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
}
