import type { ComputerLease, ComputerScope, ConversationComputer, LeaseScope } from "@opencrane/contracts";
import type { HistoryExpectedRevisions } from "@opencrane/backend/server/infra/history-store";

/**
 * Names the immutable coordinates that select one logical conversation computer.
 *
 * The history loader rejects any stored snapshot whose silo, conversation, agent identity or profile
 * differs from this command, so a caller can only read the computer it already resolved.
 * @see ComputerScope for the four ownership fields and when they change.
 */
export interface ConversationComputerCurrentCommand
{
	/** Names the silo, conversation, computer and agent identity that must all match the stored snapshot. */
	readonly computer: ComputerScope;
	/** Identifies the immutable profile revision that must remain bound to this computer; it is fixed together with `computer.agentIdentityId`. */
	readonly profileRevisionId: string;
}

/**
 * Names one lease of one computer using only what a sandbox Pod can prove about itself.
 *
 * A Pod knows its computer id and lease from its labels and the server adds the silo from trusted
 * configuration, so this is the coordinate used for the active-turn stream, the review credential
 * and the turn store. It carries no conversation or agent identity because the Pod never learns them.
 *
 * Called by: `KurrentConversationComputerActivityReader`, `KurrentConversationComputerTurnStore`
 * and `KeyedConversationComputerReviewCredentialDeriver`.
 */
export interface ConversationComputerLeaseCoordinates
{
	/** Identifies the silo fixed by server configuration, never by the Pod. */
	readonly siloId: string;
	/** Identifies the logical computer named on the Pod label. */
	readonly computerId: string;
	/** Names the lease and generation the Pod claims to hold. */
	readonly lease: LeaseScope;
}

/** Adds the server-owned clock required to decide whether one warm lease remains usable. */
export interface ActiveConversationComputerLeaseCommand extends ConversationComputerCurrentCommand
{
	/** Stores the server-owned instant used to reject an expired lease. */
	readonly nowEpochMilliseconds: number;
}

/** Carries one complete computer-and-lease snapshot to its deterministic history stream. */
export interface ConversationComputerAppendCommand
{
	/** Requires the stream revision observed by the caller before this append. */
	readonly expectedRevision: HistoryExpectedRevisions.NoStream | bigint;
	/** Supplies the caller-chosen UUID that makes a retried append idempotent. */
	readonly eventId: string;
	/** Carries the complete closed computer snapshot to persist. */
	readonly computer: ConversationComputer;
	/** Carries the current lease snapshot, or null when no lease currently exists. */
	readonly lease: ComputerLease | null;
}

/** Carries the checked computer and lease state stored at one history revision. */
export interface ConversationComputerHistorySnapshot
{
	/** Carries the logical computer state at this stream revision. */
	readonly computer: ConversationComputer;
	/** Carries the only current lease at this stream revision, if it exists. */
	readonly lease: ComputerLease | null;
}

/** Gives a later authority the current computer state and its checked KurrentDB head evidence. */
export interface CurrentConversationComputer
{
	/** Names the deterministic KurrentDB stream that supplied this snapshot. */
	readonly streamName: string;
	/** Reports the exact KurrentDB revision that supplied this current snapshot. */
	readonly revision: bigint;
	/** Carries the validated current logical computer snapshot. */
	readonly computer: ConversationComputer;
	/** Carries the validated current lease snapshot, or null when none exists. */
	readonly lease: ComputerLease | null;
}

/** Gives pre-admission activation only the current warm computer and its fenced active lease. */
export interface ActiveConversationComputerLease extends CurrentConversationComputer
{
	/** Carries the only lease that may activate the computer at this checked head. */
	readonly lease: ComputerLease;
}
