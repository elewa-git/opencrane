import type { RunWorkCancellationResult } from "@opencrane/backend/server/iam/authorization";

/** Terminal Kurrent winner adopted by the AgentRun authority. */
export enum ConversationRunCancellationDecisions
{
	/** The Stop event won the turn revision. */
	CancellationWon = "CancellationWon",
	/** The final assistant output won the turn revision. */
	OutputWon = "OutputWon",
}

/** Carries the saved workflow receipt fields used by cancellation recovery. */
export interface ConversationRunCancellationTaskReceipt
{
	/** Identifies the admitted workflow task. */
	readonly taskId: string;
	/** Identifies its reviewed task definition. */
	readonly taskName: string;
	/** Deduplicates workflow admission. */
	readonly idempotencyKey: string;
}

/** Coordinates needed to prove one selected turn still belongs to its original requester. */
export interface ConversationRunCancellationTargetCommand
{
	readonly runId: string;
	readonly siloId: string;
	readonly conversationId: string;
	readonly attempt: number;
	readonly computerId: string;
	readonly leaseId: string;
	readonly leaseGeneration: number;
	readonly requesterPrincipalId: string;
	/** Names the only workflow definition that may be stopped. */
	readonly expectedOriginalTurnTaskName: string;
}

/** Binds one Stop command to its original run, turn, requester and both workflow tasks. */
export interface ConversationRunCancellationAdmissionCommand extends ConversationRunCancellationTargetCommand
{
	/** Identifies the target turn stream. */
	readonly bootstrapId: string;
	/** Identifies the immutable Stop command. */
	readonly commandId: string;
	/** Binds the full cancellation task input. */
	readonly commandDigest: string;
	/** Identifies the original human requester. */
	readonly requesterPrincipalId: string;
	/** Identifies the authorization audit decision committed with admission. */
	readonly authorizationDecisionDigest: string;
	/** Records database time for the admitted request. */
	readonly requestedAt: Date;
	/** Identifies the original conversation-turn workflow. */
	readonly originalTurnTask: ConversationRunCancellationTaskReceipt;
	/** Identifies the cancellation workflow admitted in the same transaction. */
	readonly cancellationTask: ConversationRunCancellationTaskReceipt;
}

/** Stored cancellation admission safe to return across the runs package boundary. */
export interface ConversationRunCancellationAdmission extends ConversationRunCancellationAdmissionCommand {}

/** Records the Kurrent terminal winner for one admitted Stop command. */
export interface ConversationRunCancellationDecisionCommand
{
	/** Identifies the admitted Stop command. */
	readonly commandId: string;
	/** Requires the saved command digest. */
	readonly commandDigest: string;
	/** Identifies the Kurrent terminal winner. */
	readonly decision: ConversationRunCancellationDecisions;
	/** Records when SQL adopted the checked Kurrent receipt. */
	readonly decidedAt: Date;
}

/** Owns run cancellation transitions inside a transaction supplied by the conversation domain. */
export interface ConversationRunCancellationRepository
{
	/** Returns the stored admission for this command, or null before admission. */
	read(commandId: string): Promise<ConversationRunCancellationAdmission | null>;
	/** Rechecks the selected run, requester, lease and original workflow before Kurrent selection. */
	verifyTarget(command: ConversationRunCancellationTargetCommand): Promise<ConversationRunCancellationTaskReceipt>;
	/** Moves the requester-bound run to Cancelling and stores both workflow receipts. */
	admit(command: ConversationRunCancellationAdmissionCommand): Promise<ConversationRunCancellationAdmission>;
	/** Records the checked Kurrent winner; OutputWon also completes the run. */
	recordDecision(command: ConversationRunCancellationDecisionCommand): Promise<void>;
	/** Closes interaction and provider-free work after CancellationWon. */
	cleanup(commandId: string, commandDigest: string, now: Date): Promise<RunWorkCancellationResult>;
	/** Moves the run to Cancelled only when cleanup left no active provider claim. */
	finalize(commandId: string, commandDigest: string, now: Date): Promise<boolean>;
}
