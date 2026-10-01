import type { LeaseScope } from "@opencrane/contracts";

/**
 * Identifies the admitted attempt and computer lease that may advance a conversation run.
 *
 * The lifecycle authority checks every coordinate against the run's saved execution subject, so a
 * caller cannot advance a newer attempt or lease by presenting the run identifier alone. The saved
 * subject stores the lease flat under `computerScope`; this command carries it as the `lease` bundle
 * and the repository compares field by field.
 * Called by: `ConversationComputerTurnAuthorityService` at bootstrap and output milestones.
 */
export interface ConversationRunLifecycleCommand
{
	/** Run whose lifecycle may advance. */
	readonly runId: string;
	/** Silo that owns the run. */
	readonly siloId: string;
	/** Attempt recorded in the run's execution subject. */
	readonly attempt: number;
	/** Conversation computer admitted for this attempt. */
	readonly computerId: string;
	/** Lease and generation admitted for this attempt. */
	readonly lease: LeaseScope;
}

/** Closed lifecycle events whose state rules are owned by the runs package. */
export enum ConversationRunLifecycleEvents
{
	/** Bootstrap reached the exact admitted computer lease. */
	Start = "start",
	/** A saved paid request has no recoverable response. */
	EnterRecoveryRequired = "enter_recovery_required",
	/** Durable assistant output and its receipt are complete. */
	Complete = "complete",
}

/**
 * Persists a fenced run transition inside a transaction its implementation owns or receives.
 *
 * Implementations must treat an already-reached target state as success and reject every other
 * source state. Starting an exact run already in RecoveryRequired also succeeds without resuming it,
 * so a saved uncertain model response can reach its recovery workflow after process restart.
 * Called by: `PrismaConversationRunLifecycleUnitOfWork`.
 */
export interface ConversationRunLifecycleRepository
{
	/**
	 * Verify the saved execution subject, then move the run from the required source state.
	 * @param command - Run, attempt, and lease coordinates that must match the saved subject.
	 * @param event - Closed event whose state and write projection are defined by this owner.
	 * @throws When the attempt, lease fence, or current state does not match the transition.
	 */
	transition(command: ConversationRunLifecycleCommand, event: ConversationRunLifecycleEvents): Promise<void>;
}

/**
 * Advances an admitted conversation run after bootstrap handoff and assistant-output persistence.
 *
 * Callers must pass the lease fence admitted into the immutable execution subject. Repeating a
 * completed transition succeeds, while an unexpected state or fence mismatch rejects the call.
 * Called by: `ConversationComputerTurnAuthorityService`.
 */
export interface ConversationRunLifecycleAuthority
{
	/**
	 * Record that bootstrap reached the admitted computer and the run may execute.
	 * @param command - Fence copied from the admitted execution subject.
	 * @throws When the attempt is neither Accepted nor a restart-safe Running or RecoveryRequired state, or when its lease fence differs.
	 */
	start(command: ConversationRunLifecycleCommand): Promise<void>;
	/**
	 * Preserve a paid model response ambiguity on the exact admitted attempt and lease.
	 * @param command - Fence copied from the admitted execution subject.
	 * @throws When the attempt is neither Running nor already RecoveryRequired, or when its lease fence differs.
	 */
	enterRecoveryRequired(command: ConversationRunLifecycleCommand): Promise<void>;
	/**
	 * Record success after the assistant output and its restart receipt are durable.
	 * @param command - Fence copied from the admitted execution subject.
	 * @throws When the attempt is neither Running nor already Completed, or when its lease fence differs.
	 */
	complete(command: ConversationRunLifecycleCommand): Promise<void>;
}
