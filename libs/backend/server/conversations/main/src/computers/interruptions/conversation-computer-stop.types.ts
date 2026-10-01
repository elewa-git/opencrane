import type { IWorkflowTaskReceipt } from "@opencrane/backend/server/infra/workflows/contract";

import type { FrozenConversationComputerTurn } from "../turns/conversation-computer-turn.types";

/** Identifies the authenticated requester recorded on the Stop message. */
export interface ConversationComputerStopRequester
{
	/** Identifies the local Principal admitted by product authorization. */
	readonly principalId: string;
	/** Identifies the participant in the conversation projection. */
	readonly subjectId: string;
	/** Names the identity provider that authenticated the participant. */
	readonly issuer: string;
	/** Records the authentication instant checked for the message. */
	readonly authenticatedAt: string;
}

/** Carries a Stop request derived from one immutable participant message and control event. */
export interface ConversationComputerStopCommand
{
	/** Identifies the Stop event and all of its replay receipts. */
	readonly commandId: string;
	/** Identifies the silo selected by the authenticated request. */
	readonly siloId: string;
	/** Identifies the conversation that owns the computer. */
	readonly conversationId: string;
	/** Identifies the computer whose current turn may stop. */
	readonly computerId: string;
	/** Fences the request to the computer generation observed with the message. */
	readonly generation: number;
	/** Identifies the participant message that requested Stop. */
	readonly causationId: string;
	/** Records that message's immutable position. */
	readonly causationPosition: string;
	/** Carries the requester derived from that immutable message. */
	readonly requester: ConversationComputerStopRequester;
}

/**
 * Describes whether admission found a target turn.
 *
 * These values are stored in Kurrent receipts. Renaming a value changes the persisted history contract.
 */
export enum ConversationComputerStopAdmissionKinds
{
	/** No turn preceded this Stop message, so no run may be changed. */
	NoTarget = "no_target",
	/** A run and turn were atomically bound to the Stop command. */
	Target = "target",
}

/** Durable Stop admission recovered by the cancellation task. */
export type ConversationComputerStopAdmission =
	| {
		/** States that the command has no cancellable predecessor. */
		readonly kind: ConversationComputerStopAdmissionKinds.NoTarget;
		/** Retains the complete message-derived command for its no-target receipt. */
		readonly command: ConversationComputerStopCommand;
		/** Binds the checked command and pointer coordinates written to the receipt. */
		readonly commandDigest: string;
		/** Identifies the active-turn pointer stream checked during no-target resolution. */
		readonly activeTurnStreamName: string;
		/** Records its checked head, or null when the pointer stream did not exist. */
		readonly activeTurnExpectedRevision: string | null;
		/** Binds the current requester authorization recorded before the no-target receipt. */
		readonly authorizationDecisionDigest: string;
	}
	| {
		/** States that a run and frozen turn are bound to the command. */
		readonly kind: ConversationComputerStopAdmissionKinds.Target;
		/** Retains the complete message-derived command. */
		readonly command: ConversationComputerStopCommand;
		/** Binds the command, target and original turn receipt stored at admission. */
		readonly commandDigest: string;
		/** Identifies the admitted run and lease without retaining compiled content. */
		readonly target: ConversationComputerStopTarget;
		/** Binds the original model turn task that cancellation may stop after winning. */
		readonly originalTurnTask: IWorkflowTaskReceipt;
		/** Binds the Absurd task that owns arbitration and cleanup. */
		readonly cancellationTask: IWorkflowTaskReceipt;
		/** Records the transaction time used by the admission audit. */
		readonly requestedAt: string;
		/** Identifies the product authorization decision committed with admission. */
		readonly authorizationDecisionDigest: string;
	};

/** Stores the target coordinates required to recover cancellation without recompiling a turn. */
export interface ConversationComputerStopTarget
{
	/** Identifies the frozen Kurrent turn stream. */
	readonly bootstrapId: string;
	/** Identifies the run. */
	readonly runId: string;
	/** Fences the run to the admitted attempt. */
	readonly attempt: number;
	/** Identifies the lease held by the target turn. */
	readonly leaseId: string;
	/** Fences the lease to the target generation. */
	readonly leaseGeneration: number;
}

/** Private Kurrent selection that prevents one Stop command from choosing two targets. */
export type ConversationComputerStopSelection =
	| {
		readonly kind: ConversationComputerStopAdmissionKinds.NoTarget;
		readonly command: ConversationComputerStopCommand;
		readonly commandDigest: string;
		readonly activeTurnStreamName: string;
		readonly activeTurnExpectedRevision: string | null;
		readonly authorizationDecisionDigest: string;
	}
	| {
		readonly kind: ConversationComputerStopAdmissionKinds.Target;
		readonly command: ConversationComputerStopCommand;
		readonly commandDigest: string;
		readonly target: ConversationComputerStopTarget;
		readonly originalTurnTask: IWorkflowTaskReceipt;
		readonly activeTurnStreamName: string;
		readonly activeTurnExpectedRevision: string;
		readonly authorizationDecisionDigest: string;
	};

/**
 * Describes the Kurrent terminal decision for a Stop command.
 *
 * These values are stored in Kurrent receipts and map to the SQL cancellation decision. Renaming a value changes both recovery contracts.
 */
export enum ConversationComputerStopDecisions
{
	/** The Stop message had no preceding active turn. */
	NoTarget = "no_target",
	/** The checked pointer changed before a no-target receipt could commit. */
	Stale = "stale",
	/** Cancellation won the turn's terminal revision. */
	CancellationWon = "cancellation_won",
	/** The final assistant output won the turn's terminal revision. */
	OutputWon = "output_won",
}

/** Reports the participant-visible Stop operation state to the activation consumer. */
export enum ConversationComputerStopStatuses
{
	/** The Stop command and its cleanup workflow were durably admitted. */
	Accepted = "accepted",
	/** Cancellation and its required cleanup completed. */
	Stopped = "stopped",
	/** The same saved outcome was recovered. */
	Idempotent = "idempotent",
	/** The Stop message had no preceding active turn. */
	NothingToStop = "nothing_to_stop",
	/** Cleanup must resume from the saved cancellation task. */
	Retry = "retry",
	/** The event was stale, foreign, or unauthorized. */
	Denied = "denied",
}

/** Outcome returned to the durable control-event consumer. */
export type ConversationComputerStopOutcome =
	| { readonly status: ConversationComputerStopStatuses.Accepted | ConversationComputerStopStatuses.Stopped | ConversationComputerStopStatuses.Idempotent | ConversationComputerStopStatuses.NothingToStop | ConversationComputerStopStatuses.Denied }
	| { readonly status: ConversationComputerStopStatuses.Retry; readonly notBeforeEpochMs: number };

/** Admits or recovers one requester-bound Stop command without starting replacement work. */
export interface ConversationComputerStopAuthority
{
	/** Resolves the immutable predecessor and hands durable cleanup to its saved workflow. */
	stop(command: ConversationComputerStopCommand): Promise<ConversationComputerStopOutcome>;
}

/** Result of the Kurrent terminal-revision arbitration. */
export interface ConversationComputerStopPublishOutcome
{
	/** Identifies the terminal decision recovered or written by this call. */
	readonly decision: ConversationComputerStopDecisions;
	/** Reports whether this call wrote the decision. */
	readonly published: boolean;
	/** Carries the exact output receipt when output won. */
	readonly outputReceiptDigest: string | null;
}

/** Freezes or recovers the SQL admission and its cancellation task. */
export interface ConversationComputerStopAdmissionAuthority
{
	/** Returns a saved admission before the caller resolves any active pointer. */
	read(command: ConversationComputerStopCommand): Promise<ConversationComputerStopAdmission | null>;
	/** Atomically authorizes and binds the selected turn to a cancellation task. */
	admit(command: ConversationComputerStopCommand, selection: Extract<ConversationComputerStopSelection, { kind: ConversationComputerStopAdmissionKinds.Target }>): Promise<ConversationComputerStopAdmission>;
}

/** Resolves the turn that preceded a fresh Stop message. */
export interface ConversationComputerStopTargetReader
{
	/** Returns a candidate only when its input position precedes the Stop message, or null without an authoritative lease. */
	resolve(command: ConversationComputerStopCommand): Promise<ConversationComputerStopTargetResolution | null>;
}

/** Supplies the history-owned active-turn head after SQL resolves an exact lease. */
export interface ConversationComputerStopActiveTurnReader
{
	/** Reads the active pointer and turn for one exact lease without selecting another lease. */
	read(command: { readonly siloId: string; readonly computerId: string; readonly leaseId: string; readonly leaseGeneration: number }): Promise<{ readonly turn: FrozenConversationComputerTurn | null; readonly activeTurnStreamName: string; readonly activeTurnExpectedRevision: string | null }>;
}

/** Freezes either the predecessor turn or the checked empty active-pointer head. */
export type ConversationComputerStopTargetResolution =
	| Extract<ConversationComputerStopSelection, { kind: ConversationComputerStopAdmissionKinds.Target }>
	| { readonly kind: ConversationComputerStopAdmissionKinds.NoTarget; readonly commandDigest: string; readonly activeTurnStreamName: string; readonly activeTurnExpectedRevision: string | null; readonly authorizationDecisionDigest: string };

/** Owns Kurrent target freezing and terminal arbitration. */
export interface ConversationComputerStopPublisher
{
	/** Returns an existing Stop receipt before SQL admission attempts to resolve another target. */
	recover(command: ConversationComputerStopCommand): Promise<ConversationComputerStopPublishOutcome | null>;
	/** Returns the immutable target choice already stored for this command. */
	recoverSelection(command: ConversationComputerStopCommand): Promise<ConversationComputerStopSelection | null>;
	/** Atomically fixes the target choice against the observed active-pointer head. */
	select(command: ConversationComputerStopCommand, resolution: ConversationComputerStopTargetResolution): Promise<ConversationComputerStopSelection | null>;
	/** Records a no-target receipt or arbitrates cancellation against output for the admitted target. */
	publish(admission: ConversationComputerStopAdmission): Promise<ConversationComputerStopPublishOutcome>;
}

/** Applies the SQL decision and cleanup steps after Kurrent selected a terminal winner. */
export interface ConversationComputerStopLifecycle
{
	/** Records the exact Kurrent winner before any cancellation effect begins. */
	recordDecision(admission: Extract<ConversationComputerStopAdmission, { kind: ConversationComputerStopAdmissionKinds.Target }>, outcome: ConversationComputerStopPublishOutcome): Promise<void>;
	/** Closes interaction, provider-free work and expired claims after CancellationWon. */
	cleanup(admission: Extract<ConversationComputerStopAdmission, { kind: ConversationComputerStopAdmissionKinds.Target }>): Promise<{ readonly activeClaimCount: number; readonly nextClaimExpiryAt: string | null }>;
	/** Completes cancellation only when no active provider claim remains. */
	finalize(admission: Extract<ConversationComputerStopAdmission, { kind: ConversationComputerStopAdmissionKinds.Target }>): Promise<boolean>;
}

/** Reads the runs-owned clock on a caller-owned transaction. */
export interface ConversationComputerStopClockRepository
{
	/** Returns database-owned time for one authority decision. */
	now(): Promise<Date>;
}

/** Reads the current relational lease that can name an authoritative history pointer. */
export interface ConversationComputerStopTargetRepository
{
	/** Returns an unexpired exact-generation lease, or null when Stop must fail closed. */
	readLease(command: ConversationComputerStopCommand): Promise<{ readonly leaseId: string; readonly leaseGeneration: number } | null>;
}

/** Rechecks and records requester authority against one exact active lease. */
export interface ConversationComputerStopRequesterRepository
{
	/** Returns the current authorization decision digest or refuses the Stop permanently. */
	authorize(command: ConversationComputerStopCommand, commandDigest: `sha256:${string}`, leaseId: string, now: Date): Promise<string>;
}

/** Complete input stored with the cancellation workflow admission. */
export interface ConversationComputerStopTaskInput
{
	/** Carries the immutable human Stop command. */
	readonly command: ConversationComputerStopCommand;
	/** Carries the target fixed before any cancellation effect. */
	readonly target: ConversationComputerStopTarget;
	/** Binds this task input to the SQL admission. */
	readonly commandDigest: string;
	/** Identifies the original turn task cancellation may stop after winning. */
	readonly originalTurnTask: IWorkflowTaskReceipt;
}

/** Persisted outcomes returned by the Absurd cancellation task. */
export enum ConversationComputerStopTaskOutcomes
{
	/** Cancellation won and the run reached its UserCancelled terminal state. */
	Cancelled = "cancelled",
	/** The final assistant output won before cancellation could commit. */
	OutputCompleted = "output_completed",
}

/** Terminal result retained by the durable cancellation task. */
export type ConversationComputerStopTaskResult =
	{ readonly outcome: ConversationComputerStopTaskOutcomes; readonly commandId: string };
