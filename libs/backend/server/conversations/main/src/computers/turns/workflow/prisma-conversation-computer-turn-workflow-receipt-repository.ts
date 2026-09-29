import type { Prisma } from "@prisma/client";
import type { IWorkflowTaskReceipt } from "@opencrane/backend/server/infra/workflows/contract";

import { CONVERSATION_COMPUTER_TURN_TASK } from "./conversation-computer-turn-task";
import type { ConversationComputerTurnWorkflowReceiptBinder, ConversationComputerTurnWorkflowReceiptReader } from "./conversation-computer-turn-workflow-receipt.types";

const _UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/** Persists the immutable workflow owner of one AgentRun attempt inside a caller-owned transaction. */
export class PrismaConversationComputerTurnWorkflowReceiptRepository implements ConversationComputerTurnWorkflowReceiptBinder, ConversationComputerTurnWorkflowReceiptReader
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

	/** Read the exact saved workflow owner without writing or spawning another task. */
	public async read(runId: string, attempt: number): Promise<IWorkflowTaskReceipt | null>
	{
		_AssertRunAttempt(runId, attempt);
		const current = await this.prisma.agentRun.findUnique({ where: { id_attempt: { id: runId, attempt } }, select: { workflowTaskId: true, workflowTaskName: true, workflowTaskKey: true } });
		if (current === null || !_IsBound(current))
			return null;
		_AssertStoredReceipt(current);
		return { taskId: current.workflowTaskId, taskName: current.workflowTaskName, idempotencyKey: current.workflowTaskKey };
	}
}

/** Reject malformed engine receipts before they can become durable model authority. */
function _AssertBinding(runId: string, attempt: number, receipt: IWorkflowTaskReceipt): void
{
	_AssertRunAttempt(runId, attempt);
	if (!_UUID.test(receipt.taskId) || receipt.taskName !== CONVERSATION_COMPUTER_TURN_TASK.taskName || !_UUID.test(receipt.idempotencyKey))
		throw new Error("Conversation turn workflow binding requires the admitted conversation turn task receipt");
}

/** Reject invalid coordinates before a repository operation can address another attempt. */
function _AssertRunAttempt(runId: string, attempt: number): void
{
	if (runId.trim().length === 0 || !Number.isSafeInteger(attempt) || attempt < 1)
		throw new Error("Conversation turn workflow binding requires an exact run attempt");
}

/** Report whether all three receipt coordinates are present on a previously bound run. */
function _IsBound(value: { readonly workflowTaskId: string | null; readonly workflowTaskName: string | null; readonly workflowTaskKey: string | null }): boolean
{
	const populated = [value.workflowTaskId, value.workflowTaskName, value.workflowTaskKey].filter(field => field !== null).length;
	if (populated !== 0 && populated !== 3)
		throw new Error("AgentRun has an incomplete conversation turn workflow binding");
	return populated === 3;
}

/** Reject malformed persisted task coordinates before returning them as workflow authority. */
function _AssertStoredReceipt(value: { readonly workflowTaskId: string | null; readonly workflowTaskName: string | null; readonly workflowTaskKey: string | null }): asserts value is { readonly workflowTaskId: string; readonly workflowTaskName: string; readonly workflowTaskKey: string }
{
	if (value.workflowTaskId === null || value.workflowTaskName === null || value.workflowTaskKey === null || !_UUID.test(value.workflowTaskId) || value.workflowTaskName !== CONVERSATION_COMPUTER_TURN_TASK.taskName || !_UUID.test(value.workflowTaskKey))
		throw new Error("AgentRun has a malformed conversation turn workflow binding");
}

/** Compare every immutable receipt coordinate with the AgentRun owner. */
function _Matches(value: { readonly workflowTaskId: string | null; readonly workflowTaskName: string | null; readonly workflowTaskKey: string | null }, receipt: IWorkflowTaskReceipt): boolean
{
	return value.workflowTaskId === receipt.taskId && value.workflowTaskName === receipt.taskName && value.workflowTaskKey === receipt.idempotencyKey;
}
