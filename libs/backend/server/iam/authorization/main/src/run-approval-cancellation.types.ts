import type { ExternalActionClaimKinds, ExternalActionRecoveryModes, ToolInvocationStates } from "./tool-invocation-lifecycle.types.js";

/** Exact run-attempt coordinates whose pending approval authority must be cancelled. */
export interface CancelPendingRunApprovalAuthorityCommand
{
	/** Logical run whose pending approvals are no longer resumable. */
	readonly runId: string;
	/** Current positive attempt whose pending approvals are being closed. */
	readonly attempt: number;
	/** Trusted cancellation instant shared with the caller's run-state transition. */
	readonly now: Date;
}

/**
 * What cancellation managed to close, and what it could not.
 *
 * `activeClaimCount` is the one that matters: it counts tool calls still holding a provider claim,
 * which cancellation deliberately leaves alone. The runs package must keep the run in `Cancelling`
 * until that reaches zero — treating a non-zero count as done reports a torn-down run while a
 * provider request may still be in flight.
 */
export interface CancelPendingRunApprovalAuthorityResult
{
	/** Number of Pending approvals transitioned to Cancelled. */
	readonly cancelledCount: number;
	/** How many still-open invocations were terminalised, each with its own cancellation result. */
	readonly failedInvocationCount: number;
	/** Provider-active claims that must settle before the runs owner may finalize Cancelled. */
	readonly activeClaimCount: number;
}

/**
 * The snapshot of one tool call taken before cancellation closes it.
 *
 * Read once up front so the state machine can be consulted and the conditional update can check
 * the same `state` and `revision` it planned against. `claimKind` must be null here — a non-null
 * value means provider work may be in flight and the row must be left alone.
 */
export interface RunCancellationToolInvocation
{
	/** Trusted ToolInvocation database identity. */
	readonly id: string;
	/** Tool-call id the runtime knows, written into the failure result. */
	readonly toolInvocationId: string;
	/** Durable state interpreted by the exhaustive cancellation event planner. */
	readonly state: ToolInvocationStates;
	/** Frozen recovery capability retained for the complete planner input. */
	readonly recoveryMode: ExternalActionRecoveryModes;
	/** Null for cancellable work; a non-null claim proves provider I/O may be in flight. */
	readonly claimKind: ExternalActionClaimKinds | null;
	/** Provider-free attempts consumed before cancellation. */
	readonly preparationAttempt: number;
	/** Hard preparation deadline used by the complete planner input. */
	readonly retryDeadlineAt: Date;
	/** Exact lifecycle compare-and-set revision. */
	readonly revision: number;
}

/**
 * The four database operations cancellation performs, in the order they must happen.
 *
 * Split out from the procedure so the ordering can be tested against a fake.
 * Implemented by: ./run-approval-cancellation.ts (`PrismaRunApprovalCancellationRepository`).
 */
export interface RunApprovalCancellationRepository
{
	/** Snapshot every nonterminal invocation after the run enters Cancelling. */
	findCancellableInvocations(runId: string, attempt: number): Promise<readonly RunCancellationToolInvocation[]>;
	/** Close pending approval rows without creating resume markers. */
	cancelPending(runId: string, attempt: number, now: Date): Promise<number>;
	/** Fail every snapshotted nonterminal invocation and create exact deliveries. */
	terminaliseCancellable(invocations: readonly RunCancellationToolInvocation[], runId: string, attempt: number, now: Date): Promise<number>;
	/** Count exact provider-active claims that cancellation must leave fenced. */
	countActiveClaims(runId: string, attempt: number): Promise<number>;
}

/**
 * Runs the whole cancellation sequence as one call on the caller's transaction.
 *
 * Exists so a caller cannot build the repository itself and run the steps out of order.
 * Implemented by: ./run-approval-cancellation.ts.
 */
export interface RunApprovalCancellationUnitOfWork
{
	/** Close pending approval and invocation authority on the caller-owned transaction. */
	cancel(command: CancelPendingRunApprovalAuthorityCommand): Promise<CancelPendingRunApprovalAuthorityResult>;
}
