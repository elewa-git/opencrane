import { AgentRunState, ApprovalRequestState, ElicitationRequestState, ExternalActionRecoveryMode, Prisma, ToolInvocationState, ToolResultDeliveryState } from "@prisma/client";

import { __DigestCanonicalJson } from "../authority/canonical-json-digest";
import { __PlanToolInvocationLifecycle } from "../tool-invocations/tool-invocation-lifecycle";
import { ExternalActionRecoveryModes, TOOL_INVOCATION_PREPARATION_POLICY, ToolInvocationLifecycleActions, ToolInvocationLifecycleEvents, ToolInvocationStates } from "../tool-invocations/tool-invocation-lifecycle.types";
import { __ReconcileDeferredToolApprovalGrants } from "./deferred-tool-approval-grants";
import type { RunWorkCancellationCommand, RunWorkCancellationInvocation, RunWorkCancellationRepository, RunWorkCancellationResult } from "./run-work-cancellation.types";
import { PrismaToolInvocationRepository } from "../tool-invocations/persistence/prisma-tool-invocation-repository";

/** Maps provider-free persisted states into the lifecycle planner. */
const _STATES: Readonly<Partial<Record<ToolInvocationState, ToolInvocationStates>>> = {
	[ToolInvocationState.Preparing]: ToolInvocationStates.Preparing,
	[ToolInvocationState.AwaitingApproval]: ToolInvocationStates.AwaitingApproval,
	[ToolInvocationState.Ready]: ToolInvocationStates.Ready,
};

/** Maps recovery modes into the lifecycle planner. */
const _RECOVERY: Readonly<Record<ExternalActionRecoveryMode, ExternalActionRecoveryModes>> = {
	[ExternalActionRecoveryMode.ProviderIdempotency]: ExternalActionRecoveryModes.ProviderIdempotency,
	[ExternalActionRecoveryMode.Reconciliation]: ExternalActionRecoveryModes.Reconciliation,
	[ExternalActionRecoveryMode.Manual]: ExternalActionRecoveryModes.Manual,
};

/** Closes pending approval and provider-free tool work after cancellation won in Kurrent. */
export class PrismaRunWorkCancellationRepository implements RunWorkCancellationRepository
{
	/** Binds every cleanup read and write to the runs owner's transaction. */
	public constructor(private readonly transaction: Prisma.TransactionClient) {}

	/** Applies every write on the repository's caller-owned transaction. */
	public async cancel(command: RunWorkCancellationCommand): Promise<RunWorkCancellationResult>
	{
		const transaction = this.transaction;
		await this._RecoverExpiredClaims(command);
		const invocations = await this._CancellableInvocations(command);
		const cancelledElicitationCount = (await transaction.elicitationRequest.updateMany({ where: { runId: command.runId, attempt: command.attempt, state: ElicitationRequestState.Requested, run: { state: AgentRunState.Cancelling } }, data: { state: ElicitationRequestState.Cancelled, resolvedAt: command.now, resolvedBy: null, safeReason: "run_cancelled" } })).count;
		const cancelledApprovalCount = await this._CancelApprovals(command);
		await this._FailInvocations(command, invocations);
		const active = await transaction.toolInvocation.aggregate({ where: { runId: command.runId, attempt: command.attempt, state: { in: [ToolInvocationState.Claimed, ToolInvocationState.Reconciling] }, claimKind: { not: null }, run: { state: AgentRunState.Cancelling } }, _count: { _all: true }, _min: { claimExpiresAt: true } });
		return { cancelledApprovalCount, cancelledElicitationCount, failedInvocationCount: invocations.length, activeClaimCount: active._count._all, nextClaimExpiryAt: active._min.claimExpiresAt };
	}

	/** Clears expired claims while preserving their uncertain provider outcome during cancellation. */
	private async _RecoverExpiredClaims(command: RunWorkCancellationCommand): Promise<void>
	{
		const expired = await this.transaction.toolInvocation.findMany({ where: { runId: command.runId, attempt: command.attempt, state: { in: [ToolInvocationState.Claimed, ToolInvocationState.Reconciling] }, claimKind: { not: null }, claimExpiresAt: { lte: command.now }, run: { state: AgentRunState.Cancelling } }, select: { id: true }, orderBy: { id: "asc" } });
		const repository = new PrismaToolInvocationRepository(this.transaction);
		for (const invocation of expired)
			await repository.recoverExpiredClaim(invocation.id, command.now);
	}

	/** Loads states whose absence of a claim proves provider dispatch has not begun. */
	private async _CancellableInvocations(command: RunWorkCancellationCommand): Promise<readonly RunWorkCancellationInvocation[]>
	{
		const states = [ToolInvocationState.Preparing, ToolInvocationState.AwaitingApproval, ToolInvocationState.Ready];
		const rows = await this.transaction.toolInvocation.findMany({ where: { runId: command.runId, attempt: command.attempt, state: { in: states }, claimKind: null, run: { state: AgentRunState.Cancelling } }, select: { id: true, toolInvocationId: true, state: true, recoveryMode: true, preparationAttempt: true, retryDeadlineAt: true, revision: true }, orderBy: { id: "asc" } });
		return rows.map(function _Map(row)
		{
			const state = _STATES[row.state];
			if (state === undefined)
				throw new Error("run cancellation loaded a provider-ambiguous tool state");
			return { id: row.id, toolInvocationId: row.toolInvocationId, state, recoveryMode: _RECOVERY[row.recoveryMode], preparationAttempt: row.preparationAttempt, retryDeadlineAt: row.retryDeadlineAt, revision: row.revision };
		});
	}

	/** Cancels each pending approval and removes the grants that allowed its decision. */
	private async _CancelApprovals(command: RunWorkCancellationCommand): Promise<number>
	{
		const approvals = await this.transaction.approvalRequest.findMany({ where: { runId: command.runId, attempt: command.attempt, state: ApprovalRequestState.Pending }, select: { id: true, siloId: true }, orderBy: { id: "asc" } });
		let count = 0;
		for (const approval of approvals)
		{
			const changed = await this.transaction.approvalRequest.updateMany({ where: { id: approval.id, runId: command.runId, attempt: command.attempt, state: ApprovalRequestState.Pending, run: { state: AgentRunState.Cancelling } }, data: { state: ApprovalRequestState.Cancelled, decidedAt: command.now, decidedBy: null } });
			if (changed.count !== 1)
				continue;
			await __ReconcileDeferredToolApprovalGrants(this.transaction, approval.siloId, approval.id, null, command.now);
			count += 1;
		}
		return count;
	}

	/** Fails snapshotted provider-free invocations and creates their result deliveries. */
	private async _FailInvocations(command: RunWorkCancellationCommand, invocations: readonly RunWorkCancellationInvocation[]): Promise<void>
	{
		for (const invocation of invocations)
		{
			const action = __PlanToolInvocationLifecycle({ state: invocation.state, event: ToolInvocationLifecycleEvents.Cancelled, recoveryMode: invocation.recoveryMode, claimKind: null, preparationAttempt: invocation.preparationAttempt, preparationAttemptLimit: TOOL_INVOCATION_PREPARATION_POLICY.attemptLimit, withinPreparationDeadline: invocation.retryDeadlineAt.getTime() > command.now.getTime() });
			if (action !== ToolInvocationLifecycleActions.Fail)
				throw new Error("run cancellation cannot close this tool invocation as a definite failure");
			let state: ToolInvocationState = ToolInvocationState.Ready;
			if (invocation.state === ToolInvocationStates.Preparing)
				state = ToolInvocationState.Preparing;
			else if (invocation.state === ToolInvocationStates.AwaitingApproval)
				state = ToolInvocationState.AwaitingApproval;
			const failed = await this.transaction.toolInvocation.updateMany({ where: { id: invocation.id, runId: command.runId, attempt: command.attempt, state, revision: invocation.revision, claimKind: null, run: { state: AgentRunState.Cancelling } }, data: { state: ToolInvocationState.Failed, result: Prisma.DbNull, failureCode: "run_cancelled", completedAt: command.now, revision: { increment: 1 } } });
			if (failed.count !== 1)
				throw new Error("run cancellation lost its tool invocation fence");
			const payload = { toolInvocationId: invocation.toolInvocationId, outcome: "failed", failureCode: "run_cancelled" } as const;
			await this.transaction.toolResultDelivery.create({ data: { toolInvocationId: invocation.id, state: ToolResultDeliveryState.Pending, payload, payloadDigest: __DigestCanonicalJson(payload), createdAt: command.now } });
		}
	}
}
