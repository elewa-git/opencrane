import { AgentRunState, ApprovalRequestState, ElicitationRequestState, Prisma } from "@prisma/client";
import { __PlanDeferredToolApprovalLifecycle } from "./deferred-tool-approval-lifecycle";
import { DeferredToolApprovalLifecycleActions, DeferredToolApprovalLifecycleEvents, DeferredToolApprovalRunStates } from "./deferred-tool-approval-lifecycle.types";

/** Leaves the run waiting while approvals are still pending, or moves it back to Running once the last one is resolved. */
export async function _FinishDeferredToolApprovalBatch(transaction: Prisma.TransactionClient, runId: string, attempt: number, event: DeferredToolApprovalLifecycleEvents.Decision | DeferredToolApprovalLifecycleEvents.Expiry): Promise<void>
{
	const pendingApprovals = await transaction.approvalRequest.count({ where: { runId, attempt, state: ApprovalRequestState.Pending } });
	const pendingElicitations = await transaction.elicitationRequest.count({ where: { runId, attempt, state: ElicitationRequestState.Requested } });
	const action = __PlanDeferredToolApprovalLifecycle({ runState: DeferredToolApprovalRunStates.WaitingForInput, event, pendingCount: pendingApprovals + pendingElicitations });
	if (action === DeferredToolApprovalLifecycleActions.KeepWaiting)
		return;
	if (action !== DeferredToolApprovalLifecycleActions.Resume)
		throw new Error("deferred approval batch has no valid lifecycle action");
	const resumed = await transaction.agentRun.updateMany({ where: { id: runId, attempt, state: AgentRunState.WaitingForInput }, data: { state: AgentRunState.Running } });
	if (resumed.count !== 1)
		throw new Error("deferred approval lost its waiting run fence");
}
