import type { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { ToolInvocationEventTypes, type ToolInvocationLifecycleEvent } from "@opencrane/backend/server/iam/authorization";

import { CONVERSATION_COMPUTER_TURN_TASK } from "../conversation-computer-turn-task";
import { PrismaConversationComputerTurnWorkflowEventRepository } from "../prisma-conversation-computer-turn-workflow-events";

const _RUN_RECEIPT = {
	workflowTaskId: "task-1",
	workflowTaskName: CONVERSATION_COMPUTER_TURN_TASK.taskName,
	workflowTaskKey: "activation-1",
};

/** Build the Prisma read used to recover one run's durable workflow receipt. */
function _Transaction(receipt: typeof _RUN_RECEIPT | { readonly workflowTaskId: null; readonly workflowTaskName: null; readonly workflowTaskKey: null } | null = _RUN_RECEIPT): Prisma.TransactionClient
{
	return { agentRun: { findUnique: vi.fn().mockResolvedValue(receipt) } } as unknown as Prisma.TransactionClient;
}

/** Build one final tool failure without provider arguments or result content. */
function _FinalFailure(retrying = false): ToolInvocationLifecycleEvent
{
	return { runId: "run-1", attempt: 2, eventType: ToolInvocationEventTypes.Failed, payload: { toolInvocationId: "call-1", toolRevisionId: "revision-1", reason: "provider_unavailable", retryCount: 1, retryLimit: 3, retrying } };
}

describe("Prisma conversation computer turn workflow events", function _Suite()
{
	it.each([
		{ name: "completed result", event: { runId: "run-1", attempt: 2, eventType: ToolInvocationEventTypes.Completed, payload: { toolInvocationId: "call-1" } } as const },
		{ name: "final failure", event: _FinalFailure() },
	])("emits the exact private Absurd event for a $name through the result transaction", async function _Terminal({ event })
	{
		const transaction = _Transaction();
		const emitEventInTransaction = vi.fn().mockResolvedValue({ eventId: "event-1" });
		const repository = new PrismaConversationComputerTurnWorkflowEventRepository(transaction, { emitEventInTransaction });

		await repository.emit(event);

		expect(transaction.agentRun.findUnique).toHaveBeenCalledWith({ where: { id_attempt: { id: "run-1", attempt: 2 } }, select: { workflowTaskId: true, workflowTaskName: true, workflowTaskKey: true } });
		expect(emitEventInTransaction).toHaveBeenCalledOnce();
		expect(emitEventInTransaction).toHaveBeenCalledWith(
			{ client: transaction },
			{ taskId: "task-1", taskName: CONVERSATION_COMPUTER_TURN_TASK.taskName, idempotencyKey: "activation-1" },
			{ eventName: "tool-result:call-1", payload: { runId: "run-1", attempt: 2, toolInvocationId: "call-1", eventType: event.eventType } },
		);
	});

	it.each([
		{ name: "a started invocation", event: { runId: "run-1", attempt: 2, eventType: ToolInvocationEventTypes.Started, payload: { toolInvocationId: "call-1" } } as const },
		{ name: "a retrying failure", event: _FinalFailure(true) },
	])("does not read or wake a workflow for $name", async function _NotTerminal({ event })
	{
		const transaction = _Transaction();
		const emitEventInTransaction = vi.fn();
		const repository = new PrismaConversationComputerTurnWorkflowEventRepository(transaction, { emitEventInTransaction });

		await repository.emit(event);

		expect(transaction.agentRun.findUnique).not.toHaveBeenCalled();
		expect(emitEventInTransaction).not.toHaveBeenCalled();
	});

	it.each([
		{ name: "a missing run", receipt: null },
		{ name: "an unbound run", receipt: { workflowTaskId: null, workflowTaskName: null, workflowTaskKey: null } },
		{ name: "a run owned by another workflow", receipt: { workflowTaskId: "task-2", workflowTaskName: "another-task", workflowTaskKey: "other-key" } },
	])("does not wake $name", async function _WrongOwner({ receipt })
	{
		const transaction = _Transaction(receipt);
		const emitEventInTransaction = vi.fn();
		const repository = new PrismaConversationComputerTurnWorkflowEventRepository(transaction, { emitEventInTransaction });

		await repository.emit({ runId: "run-1", attempt: 2, eventType: ToolInvocationEventTypes.Completed, payload: { toolInvocationId: "call-1" } });

		expect(emitEventInTransaction).not.toHaveBeenCalled();
	});

	it("wakes the exact saved turn after an approval decision", async function _ApprovalWake()
	{
		const transaction = _Transaction();
		const emitEventInTransaction = vi.fn().mockResolvedValue({ eventId: "event-approval" });
		const repository = new PrismaConversationComputerTurnWorkflowEventRepository(transaction, { emitEventInTransaction });

		await repository.wake("run-1", 2, "call-approval");

		expect(transaction.agentRun.findUnique).toHaveBeenCalledWith({ where: { id_attempt: { id: "run-1", attempt: 2 } }, select: { workflowTaskId: true, workflowTaskName: true, workflowTaskKey: true } });
		expect(emitEventInTransaction).toHaveBeenCalledWith(
			{ client: transaction },
			{ taskId: "task-1", taskName: CONVERSATION_COMPUTER_TURN_TASK.taskName, idempotencyKey: "activation-1" },
			{ eventName: "tool-approval:call-approval", payload: { runId: "run-1", attempt: 2, toolInvocationId: "call-approval" } },
		);
	});
});
