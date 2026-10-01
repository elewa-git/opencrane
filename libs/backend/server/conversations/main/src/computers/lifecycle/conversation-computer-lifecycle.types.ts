import type { ComputerLease, ComputerScope, ComputerWorkspaceCheckpoint, ConversationComputer, RealizedLeaseScope } from "@opencrane/contracts";

import type { ConversationComputerActiveLeaseProjectionCommand } from "../activation/conversation-computer-activation.types";
import type { ConversationComputerCurrentCommand } from "@opencrane/backend/server/conversations/computers";

/**
 * Fixes the durable idle deadlines and lease lifetime required by the 0.11 lifecycle contract.
 *
 * Idleness is measured from the newest turn activity. A lease is renewed once less than half of
 * `leaseTtlMilliseconds` remains, so an in-use computer never reaches its shutdown time.
 */
export interface ConversationComputerIdlePolicy
{
	/** Marks a warm computer cooling after this much time without turn activity. */
	readonly staleAfterMilliseconds: number;
	/** Checkpoints and releases a cooling computer after this much time without turn activity. */
	readonly retireAfterMilliseconds: number;
	/** Sets the lifetime granted by each lease claim and renewal. */
	readonly leaseTtlMilliseconds: number;
}

/** Captures a verified immutable workspace revision before a live realization is released. */
export interface ConversationComputerCheckpointStore
{
	/** Returns null only when the selected realization has no durable checkpoint capability. */
	capture(computer: ConversationComputer, lease: ComputerLease): Promise<ComputerWorkspaceCheckpoint | null>;
}

/** Names the exact projection row that one lease published. */
export interface ConversationComputerLeaseProjectionCommand
{
	/** Names the silo, conversation, computer and agent identity stored on the row. */
	readonly computer: ComputerScope;
	/** Names the lease, generation, and process realization stored on the row. */
	readonly lease: RealizedLeaseScope;
}

/**
 * Prevents lifecycle cleanup while an admitted attempt or pending approval still uses the current lease.
 *
 * `clearActiveLease` returns false when the row belongs to another generation or when a pending approval
 * acquired the same transaction fence. The lifecycle authority must stop cleanup on false so it cannot
 * release a realization while that approval can still become executable. `extendActiveLease` moves the
 * projected expiry later and returns false when the exact row is absent or already replaced.
 *
 * Called by: {@link ConversationComputerLifecycleAuthority}.
 */
export interface ConversationComputerAttemptActivity
{
	/** Clears this active-lease projection only while no admitted attempt or approval uses it. */
	clearActiveLease(command: ConversationComputerLeaseProjectionCommand): Promise<boolean>;
	/** Extends the projected expiry of exactly this active lease. */
	extendActiveLease(command: ConversationComputerActiveLeaseProjectionCommand): Promise<boolean>;
}

/** Adds the server clock and idempotency coordinate to one lifecycle reconciliation. */
export interface ConversationComputerLifecycleCommand extends ConversationComputerCurrentCommand
{
	readonly now: Date;
	readonly eventId: string;
}

/**
 * Enumerates the observable result of one lifecycle reconciliation.
 *
 * `current` means no transition was due. `renewed` extends a live realization lease, while `cooling`
 * records that an idle computer stopped admitting new work. `active_attempt` defers cleanup because
 * an admitted attempt or approval still holds the projection fence. A completed release reports
 * `retired_to_checkpoint` when a workspace checkpoint exists, or `retired_without_checkpoint` when
 * the selected realization has no checkpoint capability. `lost` records expiry or a missing realization;
 * `terminal` means the computer already has a state that needs no lifecycle work.
 */
export type ConversationComputerLifecycleOutcome = "current" | "renewed" | "cooling" | "active_attempt" | "retired_to_checkpoint" | "retired_without_checkpoint" | "lost" | "terminal";
