import type { Prisma } from "@prisma/client";
import { ToolInvocationEventTypes, type ToolInvocationLifecycleEvent } from "@opencrane/backend/server/iam/authorization";
import type { IWorkflowEngine, IWorkflowTaskReceipt } from "@opencrane/backend/server/infra/workflows/contract";

import { CONVERSATION_COMPUTER_TURN_TASK } from "./conversation-computer-turn-task";
import { _ToolApprovalEventName, _ToolResultEventName } from "./conversation-computer-turn-workflow";
import type { ConversationComputerTurnWorkflowEventRepository } from "./conversation-computer-turn-workflow-receipt.types";

/** Delivers a terminal tool observation to its saved conversation workflow in the result transaction. */
export class PrismaConversationComputerTurnWorkflowEventRepository implements ConversationComputerTurnWorkflowEventRepository
{
	public constructor(private readonly transaction: Prisma.TransactionClient, private readonly workflows: Pick<IWorkflowEngine, "emitEventInTransaction">) {}

	/** Wake only a completed or definite-failure invocation owned by a conversation turn task. */
	public async emit(event: ToolInvocationLifecycleEvent): Promise<void>
	{
		if (!_IsTerminal(event))
			return;
		const run = await this.transaction.agentRun.findUnique({ where: { id_attempt: { id: event.runId, attempt: event.attempt } }, select: { workflowTaskId: true, workflowTaskName: true, workflowTaskKey: true } });
		const task = _TaskReceipt(run);
		if (task === null)
			return;
		await this.workflows.emitEventInTransaction(
			{ client: this.transaction },
			task,
			{ eventName: _ToolResultEventName(event.payload.toolInvocationId), payload: { runId: event.runId, attempt: event.attempt, toolInvocationId: event.payload.toolInvocationId, eventType: event.eventType } },
		);
	}

	/** Wake the exact saved turn after an approval decision changes its invocation readiness. */
	public async wake(runId: string, attempt: number, toolInvocationId: string): Promise<void>
	{
		const run = await this.transaction.agentRun.findUnique({ where: { id_attempt: { id: runId, attempt } }, select: { workflowTaskId: true, workflowTaskName: true, workflowTaskKey: true } });
		const task = _TaskReceipt(run);
		if (task === null)
			return;
		await this.workflows.emitEventInTransaction(
			{ client: this.transaction },
			task,
			{ eventName: _ToolApprovalEventName(toolInvocationId), payload: { runId, attempt, toolInvocationId } },
		);
	}
}

/** A retrying failure has no terminal result for the turn to consume yet. */
function _IsTerminal(event: ToolInvocationLifecycleEvent): boolean
{
	return event.eventType === ToolInvocationEventTypes.Completed || event.eventType === ToolInvocationEventTypes.Failed && !event.payload.retrying;
}

/** Return only the receipt owned by this workflow; other run workflows keep their own events. */
function _TaskReceipt(run: { readonly workflowTaskId: string | null; readonly workflowTaskName: string | null; readonly workflowTaskKey: string | null } | null): IWorkflowTaskReceipt | null
{
	if (run === null || run.workflowTaskId === null || run.workflowTaskName !== CONVERSATION_COMPUTER_TURN_TASK.taskName || run.workflowTaskKey === null)
		return null;
	return { taskId: run.workflowTaskId, taskName: run.workflowTaskName, idempotencyKey: run.workflowTaskKey };
}
