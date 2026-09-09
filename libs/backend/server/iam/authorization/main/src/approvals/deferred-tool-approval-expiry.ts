import { AgentRunState, ApprovalRequestState, Prisma } from "@prisma/client";
import { type ExpireDeferredToolApprovalBatchCommand, type ExpireDeferredToolApprovalBatchResult } from "./deferred-tool-approval-decision.types";
import { DeferredToolApprovalLifecycleEvents } from "./deferred-tool-approval-lifecycle.types";
import { __MarkToolInvocationApprovalRejectedInTransaction } from "../tool-invocations/persistence/tool-invocation-transaction";
import { __ReconcileDeferredToolApprovalGrants } from "./deferred-tool-approval-grants";
import { _FinishDeferredToolApprovalBatch } from "./deferred-tool-approval-batch";

/** Expires every approval past its deadline for this attempt, and resumes the run once none are left pending. */
export async function __ExpireDeferredToolApprovalBatch(transaction: Prisma.TransactionClient, command: ExpireDeferredToolApprovalBatchCommand): Promise<ExpireDeferredToolApprovalBatchResult>
{
	const run = await transaction.agentRun.findUnique({ where: { id: command.runId } });
	if (run === null || run.attempt !== command.attempt || run.state !== AgentRunState.WaitingForInput)
		return { expiredCount: 0, resumed: false };
	const due = await transaction.approvalRequest.findMany({ where: { runId: command.runId, attempt: command.attempt, state: ApprovalRequestState.Pending, expiresAt: { lte: command.now } }, orderBy: { id: "asc" } });
	let expiredCount = 0;
	for (const approval of due)
	{
		if (await _ExpireDeferredToolApproval(transaction, approval, command.now))
			expiredCount += 1;
	}
	const after = await transaction.agentRun.findUnique({ where: { id: command.runId } });
	return { expiredCount, resumed: after?.state === AgentRunState.Running };
}

/**
 * Close one overdue approval, fail the tool call it was gating, and resume the run if it was the
 * last pending approval.
 *
 * Returns false without writing anything when the row was already decided by someone else.
 */
export async function _ExpireDeferredToolApproval(transaction: Prisma.TransactionClient, approval: { id: string; siloId: string; runId: string; attempt: number; toolInvocationRowId: string; elicitationRequestId: string }, now: Date): Promise<boolean>
{
	const expired = await transaction.approvalRequest.updateMany({ where: { id: approval.id, state: ApprovalRequestState.Pending, expiresAt: { lte: now } }, data: { state: ApprovalRequestState.Expired, decidedAt: now, decidedBy: null } });
	if (expired.count !== 1)
		return false;
	if (!await __MarkToolInvocationApprovalRejectedInTransaction(transaction, approval.toolInvocationRowId, now, "approval_expired"))
		throw new Error("expired approval lost its awaiting invocation fence");
	await __ReconcileDeferredToolApprovalGrants(transaction, approval.siloId, approval.id, null, now);
	if (approval.elicitationRequestId === null)
		await _FinishDeferredToolApprovalBatch(transaction, approval.runId, approval.attempt, DeferredToolApprovalLifecycleEvents.Expiry);
	return true;
}
