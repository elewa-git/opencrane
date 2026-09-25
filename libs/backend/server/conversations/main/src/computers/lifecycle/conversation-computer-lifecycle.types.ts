import type { ComputerLease, ComputerScope, ComputerWorkspaceCheckpoint, ConversationComputer, LeaseScope } from "@opencrane/contracts";
import type { AgentSandboxClaimReleaseCommand, AgentSandboxClaimRenewCommand, AgentSandboxClaimStatus } from "@opencrane/backend/server/infra/agent-sandbox";

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
	capture(computer: ConversationComputer, lease: ComputerLease): Promise<ComputerWorkspaceCheckpoint>;
}

/** Names the exact projection row that one lease published. */
export interface ConversationComputerLeaseProjectionCommand
{
	/** Names the silo, conversation, computer and agent identity stored on the row. */
	readonly computer: ComputerScope;
	/** Names the lease and generation stored on the row. */
	readonly lease: LeaseScope;
}

/**
 * Prevents lifecycle cleanup while an admitted attempt or pending approval still uses the current lease.
 *
 * `clearActiveLease` returns false when the row belongs to another generation or when a pending approval
 * acquired the same transaction fence. The lifecycle authority must stop cleanup on false so it cannot
 * release a sandbox while that approval can still become executable. `extendActiveLease` moves the
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

/**
 * Controls the one Agent Sandbox claim that realizes a lease.
 *
 * Every operation is fenced to the deterministic claim whose immutable labels prove the lease
 * coordinates; the controller's view is evidence for lifecycle decisions, never product authority.
 */
export interface ConversationComputerSandboxClaims
{
	/** Reads the controller's current view of the claim, or null once the claim is gone. */
	inspect(command: AgentSandboxClaimReleaseCommand): Promise<AgentSandboxClaimStatus | null>;
	/** Moves the claim's shutdown time later. */
	renew(command: AgentSandboxClaimRenewCommand): Promise<"renewed" | "absent">;
	/** Deletes the exact, already-authorized claim. */
	release(command: AgentSandboxClaimReleaseCommand): Promise<"released" | "absent">;
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
 * `lost` records that the lease expired or its claim disappeared without an orderly release;
 * `renewed` records a lease extension for a computer that is still in use.
 */
export type ConversationComputerLifecycleOutcome = "current" | "renewed" | "cooling" | "active_attempt" | "retired_to_checkpoint" | "lost" | "terminal";
