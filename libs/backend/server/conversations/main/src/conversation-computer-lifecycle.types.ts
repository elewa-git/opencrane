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

/** Reports whether an admitted attempt is still using the current lease. */
export interface ConversationComputerAttemptActivity
{
	hasActiveAttempt(computerId: string, leaseId: string): Promise<boolean>;
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
