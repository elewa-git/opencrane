import type { ComputerLease, ComputerWorkspaceCheckpoint, ConversationComputer } from "@opencrane/contracts";

import type { ConversationComputerCurrentCommand } from "./conversation-computers";

/** Fixes the two durable idle deadlines required by the 0.11 lifecycle contract. */
export interface ConversationComputerIdlePolicy
{
	readonly staleAfterMilliseconds: number;
	readonly retireAfterMilliseconds: number;
}

/** Captures a verified immutable workspace revision before a live realization is released. */
export interface ConversationComputerCheckpointStore
{
	capture(computer: ConversationComputer, lease: ComputerLease): Promise<ComputerWorkspaceCheckpoint>;
}

/**
 * Prevents lifecycle cleanup while an admitted attempt or pending approval still uses the current lease.
 *
 * `clearActiveLease` returns false when the row belongs to another generation or when a pending approval
 * acquired the same transaction fence. The lifecycle authority must stop cleanup on false so it cannot
 * release a sandbox while that approval can still become executable.
 *
 * Called by: {@link ConversationComputerLifecycleAuthority}.
 */
export interface ConversationComputerAttemptActivity
{
	/** Clears this active-lease projection only while no admitted attempt or approval uses it. */
	clearActiveLease(command: { readonly siloId: string; readonly conversationId: string; readonly computerId: string; readonly agentIdentityId: string; readonly leaseId: string; readonly leaseGeneration: number }): Promise<boolean>;
}

/** Releases only an exact, already-authorized Agent Sandbox claim. */
export interface ConversationComputerClaimReleaser
{
	release(command: { readonly namespace: string; readonly claimId: string; readonly computerId: string; readonly leaseId: string; readonly generation: number }): Promise<"released" | "absent">;
}

/** Adds the server clock and idempotency coordinate to one lifecycle reconciliation. */
export interface ConversationComputerLifecycleCommand extends ConversationComputerCurrentCommand
{
	readonly now: Date;
	readonly eventId: string;
}

/** Enumerates the observable result of one lifecycle reconciliation. */
export type ConversationComputerLifecycleOutcome = "current" | "cooling" | "active_attempt" | "retired_to_checkpoint" | "terminal";
