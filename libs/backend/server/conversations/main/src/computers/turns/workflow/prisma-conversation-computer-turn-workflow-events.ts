import type { Prisma } from "@prisma/client";
import { ToolInvocationEventTypes, type ToolInvocationLifecycleEvent } from "@opencrane/backend/server/iam/authorization";
import type { IWorkflowEngine, IWorkflowTaskEvent, IWorkflowTaskReceipt } from "@opencrane/backend/server/infra/workflows/contract";
import { ___GeneratedFileEventName } from "@opencrane/contracts";

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

	/** Wake the exact parent turn after generated-file state commits in the caller's transaction. */
	public async emitGeneratedFile(runId: string, attempt: number, event: IWorkflowTaskEvent<{ readonly operationId: string }>): Promise<void>
	{
		if (!_Coordinate(runId) || !Number.isSafeInteger(attempt) || attempt < 1 || event.timedOut === true || event.payload === null
			|| event.eventName !== ___GeneratedFileEventName(event.payload.operationId))
			throw new Error("Generated file parent workflow event is invalid");
		const run = await this.transaction.agentRun.findUnique({ where: { id_attempt: { id: runId, attempt } }, select: { workflowTaskId: true, workflowTaskName: true, workflowTaskKey: true } });
		const task = _TaskReceipt(run);
		if (task === null)
			throw new Error("Generated file parent workflow receipt was not found");
		// The event only wakes the parent. It must reload current file state instead of trusting caller metadata.
		const wake = { eventName: event.eventName, payload: { operationId: event.payload.operationId } };
		await this.workflows.emitEventInTransaction({ client: this.transaction }, task, wake);
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

/** Reject empty, normalized, control-bearing or unbounded run coordinates. */
function _Coordinate(value: unknown): value is string
{
	return typeof value === "string" && value.length > 0 && value.length <= 512 && value === value.trim() && !/[\p{Cc}]/u.test(value);
}
