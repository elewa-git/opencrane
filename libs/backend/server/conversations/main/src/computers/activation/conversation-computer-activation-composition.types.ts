import type { Logger } from "@opencrane/backend/observability";
import type { ConversationComputerActivationConsumerHealth, ConversationComputerActivationResubscribePolicy } from "./conversation-computer-activation.types";

/**
 * Owns the lifetime of this replica's competing consumer on the silo activation queue.
 *
 * Called by: apps/opencrane/src/bootstrap/process/lifecycle.ts during the `drain_workers` shutdown stage.
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
	/** Asks the app to react when the subscription has exhausted its reopen budget. */
	readonly onExhausted: () => void;
	/** Records subscription lifecycle observations through the process logger. */
	readonly logger: Pick<Logger, "info" | "warn" | "fatal">;
	/** Overrides part of the default reopen policy. */
	readonly resubscribe?: Partial<ConversationComputerActivationResubscribePolicy>;
	/** Replaces the clock wait between attempts and before a delivery retry. */
	readonly wait?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
}
