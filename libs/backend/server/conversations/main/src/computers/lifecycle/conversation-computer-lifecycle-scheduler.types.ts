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
	/** Returns due computers from one stable projection page and the cursor for the next page. */
	enumerateDue(now: Date, limit: number, afterConversationId: string | null): Promise<ConversationComputerLifecycleCandidatePage>;
}

/** Carries due candidates separately from the cursor over every inspected projection row. */
export interface ConversationComputerLifecycleCandidatePage
{
	/** Contains due computers found in this projection page. */
	readonly items: readonly ConversationComputerLifecycleCandidate[];
	/** Advances past inspected non-due rows as well as due rows. */
	readonly nextCursor: string | null;
}

/** Reconciles one lifecycle command against authoritative Kurrent history. */
export interface ConversationComputerLifecycleReconciler
{
	/** Applies one idempotent lifecycle event. */
	reconcile(command: ConversationComputerLifecycleCommand): Promise<ConversationComputerLifecycleOutcome>;
}
