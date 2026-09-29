import type { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { CONVERSATION_COMPUTER_TURN_TASK } from "../conversation-computer-turn-task";
import { PrismaConversationComputerTurnWorkflowReceiptRepository } from "../prisma-conversation-computer-turn-workflow-receipt-repository";

const _RECEIPT = { taskId: "11111111-1111-4111-8111-111111111111", taskName: CONVERSATION_COMPUTER_TURN_TASK.taskName, idempotencyKey: "22222222-2222-4222-8222-222222222222" };
const _EMPTY = { workflowTaskId: null, workflowTaskName: null, workflowTaskKey: null };

/** Build a transaction-bound receipt repository around one controlled AgentRun row. */
function _Fixture(row: typeof _EMPTY | { workflowTaskId: string | null; workflowTaskName: string | null; workflowTaskKey: string | null } | null)
{
	const findUnique = vi.fn().mockResolvedValue(row);
	const updateMany = vi.fn();
	const findFirst = vi.fn();
	const transaction = { agentRun: { findUnique, findFirst, updateMany } } as unknown as Prisma.TransactionClient;
	return { repository: new PrismaConversationComputerTurnWorkflowReceiptRepository(transaction), findUnique, findFirst, updateMany };
}

describe("PrismaConversationComputerTurnWorkflowReceiptRepository", function _Suite()
{
	it("returns null when the run attempt is missing or unbound", async function _ReturnsNull()
	{
		await expect(_Fixture(null).repository.read("run-1", 1)).resolves.toBeNull();
		await expect(_Fixture(_EMPTY).repository.read("run-1", 1)).resolves.toBeNull();
	});

	it("returns the exact saved receipt without writes or task spawning", async function _ReadsReceipt()
	{
		const fixture = _Fixture({ workflowTaskId: _RECEIPT.taskId, workflowTaskName: _RECEIPT.taskName, workflowTaskKey: _RECEIPT.idempotencyKey });
		await expect(fixture.repository.read("run-1", 1)).resolves.toEqual(_RECEIPT);
		expect(fixture.findUnique).toHaveBeenCalledOnce();
		expect(fixture.findFirst).not.toHaveBeenCalled();
		expect(fixture.updateMany).not.toHaveBeenCalled();
	});

	it("rejects partial or malformed saved coordinates", async function _RejectsInvalidReceipt()
	{
		await expect(_Fixture({ workflowTaskId: _RECEIPT.taskId, workflowTaskName: null, workflowTaskKey: _RECEIPT.idempotencyKey }).repository.read("run-1", 1)).rejects.toThrow("incomplete");
		await expect(_Fixture({ workflowTaskId: "not-a-uuid", workflowTaskName: _RECEIPT.taskName, workflowTaskKey: _RECEIPT.idempotencyKey }).repository.read("run-1", 1)).rejects.toThrow("malformed");
		await expect(_Fixture({ workflowTaskId: _RECEIPT.taskId, workflowTaskName: "other-task", workflowTaskKey: _RECEIPT.idempotencyKey }).repository.read("run-1", 1)).rejects.toThrow("malformed");
		await expect(_Fixture({ workflowTaskId: _RECEIPT.taskId, workflowTaskName: _RECEIPT.taskName, workflowTaskKey: "not-a-uuid" }).repository.read("run-1", 1)).rejects.toThrow("malformed");
	});
});
