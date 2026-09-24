import type { Prisma } from "@prisma/client";
import type { IWorkflowTaskReceipt } from "@opencrane/backend/server/infra/workflows/contract";

import { CONVERSATION_COMPUTER_TURN_TASK } from "./conversation-computer-turn-task";
import type { ConversationComputerTurnWorkflowReceiptBinder } from "./conversation-computer-turn-workflow-receipt.types";

const _UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/** Persists the immutable workflow owner of one AgentRun attempt inside a caller-owned transaction. */
export class PrismaConversationComputerTurnWorkflowReceiptRepository implements ConversationComputerTurnWorkflowReceiptBinder
{
	/** Keeps direct AgentRun delegate access inside this narrow persistence adapter. */
	public constructor(private readonly prisma: Prisma.TransactionClient) {}

	/** Claim an unbound attempt, accept its exact replay, and reject every competing task. */
	public async bind(runId: string, attempt: number, receipt: IWorkflowTaskReceipt): Promise<boolean>
	{
		_AssertBinding(runId, attempt, receipt);
		const current = await this.prisma.agentRun.findUnique({ where: { id_attempt: { id: runId, attempt } }, select: { workflowTaskId: true, workflowTaskName: true, workflowTaskKey: true } });
		if (current === null)
			return false;
		if (_IsBound(current))
			return _Matches(current, receipt);

		const competing = await this.prisma.agentRun.findFirst({ where: { OR: [{ workflowTaskId: receipt.taskId }, { workflowTaskName: receipt.taskName, workflowTaskKey: receipt.idempotencyKey }] }, select: { id: true } });
		if (competing !== null)
			return false;
		const claimed = await this.prisma.agentRun.updateMany({ where: { id: runId, attempt, workflowTaskId: null, workflowTaskName: null, workflowTaskKey: null }, data: { workflowTaskId: receipt.taskId, workflowTaskName: receipt.taskName, workflowTaskKey: receipt.idempotencyKey } });
		if (claimed.count === 1)
			return true;
		const winner = await this.prisma.agentRun.findUnique({ where: { id_attempt: { id: runId, attempt } }, select: { workflowTaskId: true, workflowTaskName: true, workflowTaskKey: true } });
		return winner !== null && _Matches(winner, receipt);
	}
}

/** Reject malformed engine receipts before they can become durable model authority. */
function _AssertBinding(runId: string, attempt: number, receipt: IWorkflowTaskReceipt): void
{
	if (runId.trim().length === 0 || !Number.isSafeInteger(attempt) || attempt < 1)
		throw new Error("Conversation turn workflow binding requires an exact run attempt");
	if (!_UUID.test(receipt.taskId) || receipt.taskName !== CONVERSATION_COMPUTER_TURN_TASK.taskName || !_UUID.test(receipt.idempotencyKey))
		throw new Error("Conversation turn workflow binding requires the admitted conversation turn task receipt");
}

/** Report whether all three receipt coordinates are present on a previously bound run. */
function _IsBound(value: { readonly workflowTaskId: string | null; readonly workflowTaskName: string | null; readonly workflowTaskKey: string | null }): boolean
{
	const populated = [value.workflowTaskId, value.workflowTaskName, value.workflowTaskKey].filter(field => field !== null).length;
	if (populated !== 0 && populated !== 3)
		throw new Error("AgentRun has an incomplete conversation turn workflow binding");
	return populated === 3;
}

/** Compare every immutable receipt coordinate with the AgentRun owner. */
function _Matches(value: { readonly workflowTaskId: string | null; readonly workflowTaskName: string | null; readonly workflowTaskKey: string | null }, receipt: IWorkflowTaskReceipt): boolean
{
	return value.workflowTaskId === receipt.taskId && value.workflowTaskName === receipt.taskName && value.workflowTaskKey === receipt.idempotencyKey;
}
