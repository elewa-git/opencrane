import { TOOL_INVOCATION_PREPARATION_POLICY } from "./tool-invocation-lifecycle.types";

/** Run event written when automatic recovery gives up and a person must decide what happened. */
export interface ToolInvocationRecoveryEvent
{
	/** Run entering its explicit recovery-required state. */
	readonly runId: string;
	/** Attempt fence visible to the cancellation API. */
	readonly expectedAttempt: number;
	/** Public runtime tool-call coordinate. */
	readonly toolInvocationId: string;
	/** Provider-free preparation attempts consumed before dispatch. */
	readonly preparationRetryCount: number;
	/** Fixed provider-free preparation attempt limit. */
	readonly preparationRetryLimit: typeof TOOL_INVOCATION_PREPARATION_POLICY.attemptLimit;
	/** Fixed safe classification, never a provider message or body. */
	readonly providerOutcome: "unknown_after_dispatch";
}

/**
 * Appends recovery events using the caller's transaction, so this package does not have to depend on the runs package.
 * @see ToolInvocationRunRecoveryAuthority
 */
export interface ToolInvocationRecoveryEventSink
{
	/**
	 * Adds one manual-recovery entry using the caller's open transaction.
	 * @param transaction - The Prisma transaction moving the invocation into `RecoveryRequired`.
	 * @param event - Fixed, non-secret summary; never a provider message or body.
	 * @returns True when the entry was written. False means the caller must abort the transition, so
	 *   an invocation can never reach `RecoveryRequired` invisibly.
	 */
	appendInTransaction(transaction: unknown, event: ToolInvocationRecoveryEvent): Promise<boolean>;
}

/** Run and attempt whose state may change, and only in the same transaction as an invocation entering recovery. */
export interface ToolInvocationRunRecoveryCommand
{
	/** Run whose automatic provider work is changing its recovery state. */
	readonly runId: string;
	/** Current attempt protected by the run-state compare-and-set. */
	readonly attempt: number;
}

/**
 * What the runs package answers when this package asks to move a run into manual recovery.
 *
 * The caller must react differently to each one, and ./prisma-tool-invocation-unit-of-work.ts
 * (`_enterRecoveryRequired`) does:
 * - `Entered` and `AlreadyRecoveryRequired` -> write the recovery entry and commit. The second is
 *   a replay after a retried transaction, not an error.
 * - `Cancelling` -> commit the invocation change but write NO recovery entry. The run is already
 *   being torn down, and a recovery entry would ask a person to act on work that is going away.
 *   The cleared provider claim still commits so cancellation can finish without repeating the
 *   provider call.
 * - `Conflict` -> throw. The run id, attempt, or state does not match, which means we are looking
 *   at the wrong attempt; committing anyway would strand a run in the wrong state.
 *
 * These are string values on purpose because they cross a package boundary.
 * Called by: libs/backend/agents/execution/runs/main/src/prisma-tool-invocation-run-recovery-authority.ts
 * (returns them) and ./prisma-tool-invocation-unit-of-work.ts (branches on them).
 * @see {@link ToolInvocationRunRecoveryAuthority}
 */
export enum ToolInvocationRunRecoveryEnterResults
{
	/** This transaction moved the exact run attempt into manual recovery. */
	Entered = "entered",
	/** The exact run attempt was already in the required manual-recovery state. */
	AlreadyRecoveryRequired = "already_recovery_required",
	/** The exact run attempt is cancelling and must remain under cancellation authority. */
	Cancelling = "cancelling",
	/** The run identity, attempt, or state does not permit this recovery transition. */
	Conflict = "conflict",
}

/** Exact runs-owned decision when an invocation requires manual recovery. */
export type ToolInvocationRunRecoveryEnterResult = ToolInvocationRunRecoveryEnterResults;

/** Run-state operations the runs package provides, called inside this package's invocation transaction. */
export interface ToolInvocationRunRecoveryAuthority
{
	/**
	 * Moves one run attempt into its manual-recovery state.
	 * @param transaction - The Prisma transaction already changing the invocation. Typed `unknown`
	 *   so this package holds no Prisma dependency from the runs side.
	 * @param command - The run id and the attempt the caller believes is current; the runs package
	 *   checks the attempt itself and answers `Conflict` if it moved on.
	 * @returns Which of the four {@link ToolInvocationRunRecoveryEnterResults} happened. The caller
	 *   must branch on all four — see that enum for what each one obliges it to do.
	 */
	enterRecoveryRequiredInTransaction(transaction: unknown, command: ToolInvocationRunRecoveryCommand): Promise<ToolInvocationRunRecoveryEnterResult>;
	/**
	 * Puts a recovered run attempt back to running.
	 *
	 * Only legal once no invocation on that attempt is still in `RecoveryRequired` — resuming while
	 * one is unresolved would let the worker pick up an action whose real-world outcome is still
	 * unknown. The caller is responsible for that check; this port does not make it.
	 * @param transaction - The Prisma transaction performing the resume.
	 * @param command - Run id and the attempt expected to still be current.
	 * @returns True when the run moved back to running. False when the attempt or state no longer
	 *   matches, which the caller must treat as "someone else changed this run".
	 * Called by: no caller in this repo yet — only the runs-side implementation and its tests
	 * (libs/backend/agents/execution/runs/main/src/prisma-tool-invocation-run-recovery-authority.ts).
	 */
	resumeRunningInTransaction(transaction: unknown, command: ToolInvocationRunRecoveryCommand): Promise<boolean>;
}
