import { AgentRunState, ApprovalRequestState, ElicitationRequestState, ExternalActionClaimKind, ExternalActionRecoveryMode, Prisma, ToolInvocationState, ToolResultDeliveryState } from "@prisma/client";

import { __DigestCanonicalJson } from "./canonical-json-digest.js";
import type { CancelPendingRunApprovalAuthorityCommand, CancelPendingRunApprovalAuthorityResult, RunApprovalCancellationRepository, RunApprovalCancellationUnitOfWork, RunCancellationToolInvocation } from "./run-approval-cancellation.types.js";
import { __PlanToolInvocationLifecycle } from "./tool-invocation-lifecycle.js";
import { ExternalActionClaimKinds, ExternalActionRecoveryModes, TOOL_INVOCATION_PREPARATION_POLICY, ToolInvocationLifecycleActions, ToolInvocationLifecycleEvents, ToolInvocationStates } from "./tool-invocation-lifecycle.types.js";

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

/** Prisma cancellation repository bound to the caller-owned run transaction. */
export class PrismaRunApprovalCancellationRepository implements RunApprovalCancellationRepository
{
	/** Exact cancellation transaction. */
	private readonly _transaction: Prisma.TransactionClient;

	/** Bind approval and invocation writes to the run cancellation transaction. */
	constructor(transaction: Prisma.TransactionClient)
	{
		this._transaction = transaction;
	}

	/** Snapshot every nonterminal invocation after the run enters Cancelling. */
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
 * Cancels pending approval authority inside a caller-owned run cancellation transaction.
 * Decided approvals remain immutable; only Pending rows for the exact run attempt are closed, and
	 * no late approval can resume cancelled work.
 * @param transaction - Prisma transaction already holding the owning run cancellation fence.
 * @param command - Exact run attempt and trusted cancellation instant.
 * @returns The number of Pending approvals transitioned to Cancelled.
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
