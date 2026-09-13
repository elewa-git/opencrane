import type { ConversationComputerStates } from "@opencrane/contracts";

import type { ConversationComputerLifecycleCommand, ConversationComputerLifecycleOutcome } from "./conversation-computer-lifecycle.types";

/** Projection row sufficient to reconstruct one nonterminal computer lifecycle command. */
export interface ConversationComputerLifecycleCandidate extends Omit<ConversationComputerLifecycleCommand, "eventId" | "now">
{
	/** Current projected lifecycle state used in the deterministic event coordinate. */
	readonly state: ConversationComputerStates;
	/** Next server-owned deadline at which this row should be reconciled. */
	readonly deadline: Date;
}

/** Enumerates bounded nonterminal projected computers due for reconciliation. */
export interface ConversationComputerLifecycleEnumerator
{
	/** Returns at most `limit` due computers in stable projection order. */
	enumerateDue(now: Date, limit: number): Promise<readonly ConversationComputerLifecycleCandidate[]>;
}

/** Reconciles one lifecycle command against authoritative Kurrent history. */
export interface ConversationComputerLifecycleReconciler
{
	/** Applies one idempotent lifecycle event. */
	reconcile(command: ConversationComputerLifecycleCommand): Promise<ConversationComputerLifecycleOutcome>;
}
