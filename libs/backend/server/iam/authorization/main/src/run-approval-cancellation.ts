import { AgentRunState, ApprovalRequestState, ElicitationRequestState, ExternalActionClaimKind, ExternalActionRecoveryMode, Prisma, ToolInvocationState, ToolResultDeliveryState } from "@prisma/client";

import { __DigestCanonicalJson } from "./canonical-json-digest";
import type { CancelPendingRunApprovalAuthorityCommand, CancelPendingRunApprovalAuthorityResult, RunApprovalCancellationRepository, RunApprovalCancellationUnitOfWork, RunCancellationToolInvocation } from "./run-approval-cancellation.types";
import { __PlanToolInvocationLifecycle } from "./tool-invocation-lifecycle";
import { ExternalActionClaimKinds, ExternalActionRecoveryModes, TOOL_INVOCATION_PREPARATION_POLICY, ToolInvocationLifecycleActions, ToolInvocationLifecycleEvents, ToolInvocationStates } from "./tool-invocation-lifecycle.types";

/** Invocation states cancellation may close, because no provider call can be in flight in any of them. */
const _CANCELLABLE_INVOCATION_STATES: readonly ToolInvocationState[] = [ToolInvocationState.Preparing, ToolInvocationState.AwaitingApproval, ToolInvocationState.Ready, ToolInvocationState.Reconciling, ToolInvocationState.RecoveryRequired];

/** Persistence-to-domain state mapping for the planner boundary. */
const _STATE_FROM_PRISMA: Readonly<Record<ToolInvocationState, ToolInvocationStates>> = {
	[ToolInvocationState.Preparing]: ToolInvocationStates.Preparing,
	[ToolInvocationState.AwaitingApproval]: ToolInvocationStates.AwaitingApproval,
	[ToolInvocationState.Ready]: ToolInvocationStates.Ready,
	[ToolInvocationState.Claimed]: ToolInvocationStates.Claimed,
	[ToolInvocationState.Reconciling]: ToolInvocationStates.Reconciling,
	[ToolInvocationState.Succeeded]: ToolInvocationStates.Succeeded,
	[ToolInvocationState.Failed]: ToolInvocationStates.Failed,
	[ToolInvocationState.RecoveryRequired]: ToolInvocationStates.RecoveryRequired,
};

/** Planner-to-persistence state mapping used by exact cancellation CAS. */
const _STATE_TO_PRISMA: Readonly<Record<ToolInvocationStates, ToolInvocationState>> = Object.fromEntries(Object.entries(_STATE_FROM_PRISMA).map(function _reverse(entry) { return [entry[1], entry[0]]; })) as unknown as Readonly<Record<ToolInvocationStates, ToolInvocationState>>;

/** Persistence-to-domain recovery mapping for complete planner inputs. */
const _RECOVERY_FROM_PRISMA: Readonly<Record<ExternalActionRecoveryMode, ExternalActionRecoveryModes>> = {
	[ExternalActionRecoveryMode.ProviderIdempotency]: ExternalActionRecoveryModes.ProviderIdempotency,
	[ExternalActionRecoveryMode.Reconciliation]: ExternalActionRecoveryModes.Reconciliation,
	[ExternalActionRecoveryMode.Manual]: ExternalActionRecoveryModes.Manual,
};

/** Persistence-to-domain claim mapping. */
function _claimKind(kind: ExternalActionClaimKind | null): ExternalActionClaimKinds | null
{
	if (kind === null) return null;
	return kind === ExternalActionClaimKind.Dispatch ? ExternalActionClaimKinds.Dispatch : ExternalActionClaimKinds.Reconcile;
}

/**
 * The database writes cancellation needs, all on the caller's transaction.
 *
 * Exported for tests and for the unit of work in this file; production code should call
 * {@link __CancelPendingRunApprovalAuthority}, which runs the three steps in the required order.
 * Every query re-asserts that the run is on the expected attempt and in `Cancelling`, so a stale
 * cancellation cannot close work on a newer attempt.
 */
export class PrismaRunApprovalCancellationRepository implements RunApprovalCancellationRepository
{
	/** Exact cancellation transaction. */
	private readonly _transaction: Prisma.TransactionClient;

	/** Bind approval and invocation writes to the run cancellation transaction. */
	constructor(transaction: Prisma.TransactionClient)
	{
		this._transaction = transaction;
	}

	/** List the unfinished tool calls that can be closed safely — those holding no provider claim. The claim check is what keeps in-flight provider work out of this list. */
	async findCancellableInvocations(runId: string, attempt: number): Promise<readonly RunCancellationToolInvocation[]>
	{
		const rows = await this._transaction.toolInvocation.findMany({ where: { runId, attempt, state: { in: [..._CANCELLABLE_INVOCATION_STATES] }, claimKind: null, run: { is: { attempt, state: AgentRunState.Cancelling } } }, select: { id: true, toolInvocationId: true, state: true, recoveryMode: true, claimKind: true, preparationAttempt: true, retryDeadlineAt: true, revision: true }, orderBy: { id: "asc" } });
		return rows.map(function _record(row)
		{
			return { id: row.id, toolInvocationId: row.toolInvocationId, state: _STATE_FROM_PRISMA[row.state], recoveryMode: _RECOVERY_FROM_PRISMA[row.recoveryMode], claimKind: _claimKind(row.claimKind), preparationAttempt: row.preparationAttempt, retryDeadlineAt: row.retryDeadlineAt, revision: row.revision };
		});
	}

	/** Close pending approvals without resume authority. */
	async cancelPending(runId: string, attempt: number, now: Date): Promise<number>
	{
		await this._transaction.elicitationRequest.updateMany({ where: { runId, attempt, state: ElicitationRequestState.Requested }, data: { state: ElicitationRequestState.Cancelled, resolvedAt: now, resolvedBy: null, safeReason: "run_cancelled" } });
		const cancelled = await this._transaction.approvalRequest.updateMany({ where: { runId, attempt, state: ApprovalRequestState.Pending }, data: { state: ApprovalRequestState.Cancelled, decidedAt: now, decidedBy: null } });
		return cancelled.count;
	}

	/** Fail every nonterminal invocation and create its exact cancellation delivery. */
	async terminaliseCancellable(invocations: readonly RunCancellationToolInvocation[], runId: string, attempt: number, now: Date): Promise<number>
	{
		for (const invocation of invocations)
		{
			const action = __PlanToolInvocationLifecycle({ state: invocation.state, event: ToolInvocationLifecycleEvents.Cancelled, recoveryMode: invocation.recoveryMode, claimKind: invocation.claimKind, preparationAttempt: invocation.preparationAttempt, preparationAttemptLimit: TOOL_INVOCATION_PREPARATION_POLICY.attemptLimit, withinPreparationDeadline: invocation.retryDeadlineAt.getTime() > now.getTime() });
			if (action !== ToolInvocationLifecycleActions.Fail) throw new Error("run cancellation attempted to close provider-active invocation work");
			const failed = await this._transaction.toolInvocation.updateMany({ where: { id: invocation.id, runId, attempt, state: _STATE_TO_PRISMA[invocation.state], revision: invocation.revision, claimKind: null, run: { is: { attempt, state: AgentRunState.Cancelling } } }, data: { state: ToolInvocationState.Failed, result: Prisma.DbNull, failureCode: "run_cancelled", completedAt: now, revision: { increment: 1 } } });
			if (failed.count !== 1) throw new Error("run cancellation lost an exact cancellable invocation fence");
		}
		const deliveries = invocations.map(function _delivery(invocation)
		{
			const payload = { toolInvocationId: invocation.toolInvocationId, outcome: "failed", failureCode: "run_cancelled" } as const;
			return { toolInvocationId: invocation.id, state: ToolResultDeliveryState.Pending, payload, payloadDigest: __DigestCanonicalJson(payload), createdAt: now };
		});
		if (deliveries.length > 0) await this._transaction.toolResultDelivery.createMany({ data: deliveries });
		return invocations.length;
	}

	/** Counts invocations that still hold a live provider claim; cancellation must leave those alone. */
	async countActiveClaims(runId: string, attempt: number): Promise<number>
	{
		return this._transaction.toolInvocation.count({ where: { runId, attempt, state: { in: [ToolInvocationState.Claimed, ToolInvocationState.Reconciling] }, claimKind: { not: null }, run: { is: { attempt, state: AgentRunState.Cancelling } } } });
	}
}

/**
 * Shut down one cancelling run's approvals and its unfinished tool calls, in the caller's
 * transaction.
 *
 * Does three things, in order: snapshot every tool call that can still be closed safely, cancel
 * every pending approval (never resuming the run), and fail those tool calls with `run_cancelled`
 * plus a result delivery each. Already-decided approvals are left untouched, so a late approval
 * cannot resurrect cancelled work.
 *
 * Deliberately does NOT touch tool calls that currently hold a provider claim — those may have a
 * request in flight. It counts them instead and returns the count, and the runs package must wait
 * for that count to reach zero before reporting the run fully cancelled. Report the run as torn
 * down while `activeClaimCount` is above zero and you will claim a pod is gone while it is still
 * talking to a provider.
 *
 * Called by: libs/backend/agents/execution/runs/main/src/prisma-run-cancellation-repository.ts.
 * @param transaction - Prisma transaction that has already moved the run to `Cancelling`.
 * @param command - Run id, expected attempt, and the trusted cancellation time.
 * @returns Counts of approvals cancelled, tool calls failed, and provider claims still active.
 * @throws When a snapshotted tool call is no longer closable, or when the state machine refuses to
 *   fail it — both mean the run moved unexpectedly and the transaction must roll back.
 */
export async function __CancelPendingRunApprovalAuthority(transaction: Prisma.TransactionClient, command: CancelPendingRunApprovalAuthorityCommand): Promise<CancelPendingRunApprovalAuthorityResult>
{
	return new PrismaRunApprovalCancellationUnitOfWork(transaction).cancel(command);
}

/** Creates the cancellation repository on the caller's transaction and runs the cancellation steps in order. */
class PrismaRunApprovalCancellationUnitOfWork implements RunApprovalCancellationUnitOfWork
{
	/** Exact cancellation transaction. */
	private readonly _transaction: Prisma.TransactionClient;

	/** Bind repository construction to the caller-owned transaction. */
	constructor(transaction: Prisma.TransactionClient)
	{
		this._transaction = transaction;
	}

	/** Closes pending approvals and remaining invocation work, without handing Prisma models to the caller. */
	async cancel(command: CancelPendingRunApprovalAuthorityCommand): Promise<CancelPendingRunApprovalAuthorityResult>
	{
		const repository = new PrismaRunApprovalCancellationRepository(this._transaction);
		// 1. Snapshot every nonterminal invocation after the caller has entered Cancelling.
		const invocations = await repository.findCancellableInvocations(command.runId, command.attempt);

		// 2. Close every pending approval; cancellation never resumes the run.
		const cancelledCount = await repository.cancelPending(command.runId, command.attempt, command.now);

		// 3. Terminalise every remaining invocation, so nothing can still be dispatched after cancellation.
		const failedInvocationCount = invocations.length === 0 ? 0 : await repository.terminaliseCancellable(invocations, command.runId, command.attempt, command.now);
		const activeClaimCount = await repository.countActiveClaims(command.runId, command.attempt);
		return { cancelledCount, failedInvocationCount, activeClaimCount };
	}
}
