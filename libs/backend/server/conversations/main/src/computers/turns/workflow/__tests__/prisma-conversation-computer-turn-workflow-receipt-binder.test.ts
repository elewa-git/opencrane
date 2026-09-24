import type { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { CONVERSATION_COMPUTER_TURN_TASK } from "../conversation-computer-turn-task";
import { PrismaConversationComputerTurnWorkflowReceiptBinder } from "../prisma-conversation-computer-turn-workflow-receipt-binder";

const _RECEIPT = { taskId: "11111111-1111-4111-8111-111111111111", taskName: CONVERSATION_COMPUTER_TURN_TASK.taskName, idempotencyKey: "22222222-2222-4222-8222-222222222222" };
const _EMPTY = { workflowTaskId: null, workflowTaskName: null, workflowTaskKey: null };

/** Build the transaction and root Prisma seam around one controlled AgentRun row. */
function _Fixture(initial: typeof _EMPTY | { workflowTaskId: string; workflowTaskName: string; workflowTaskKey: string }, competing: { id: string } | null = null)
{
	let row = initial;
	const findUnique = vi.fn(async function _Find() { return row; });
	const findFirst = vi.fn().mockResolvedValue(competing);
	const updateMany = vi.fn(async function _Update()
	{
		if (row.workflowTaskId !== null)
			return { count: 0 };
		row = { workflowTaskId: _RECEIPT.taskId, workflowTaskName: _RECEIPT.taskName, workflowTaskKey: _RECEIPT.idempotencyKey };
		return { count: 1 };
	});
	const transaction = { agentRun: { findUnique, findFirst, updateMany } } as unknown as Prisma.TransactionClient;
	const $transaction = vi.fn(async function _Transaction(work: (client: Prisma.TransactionClient) => Promise<boolean>) { return work(transaction); });
	return { binder: new PrismaConversationComputerTurnWorkflowReceiptBinder({ $transaction } as never), findFirst, updateMany, $transaction };
}

describe("PrismaConversationComputerTurnWorkflowReceiptBinder", function _Suite()
{
	it("claims an unbound attempt and accepts the exact receipt replay", async function _ClaimsAndReplays()
	{
		const fixture = _Fixture(_EMPTY);
		await expect(fixture.binder.bind("run-1", 1, _RECEIPT)).resolves.toBe(true);
		await expect(fixture.binder.bind("run-1", 1, _RECEIPT)).resolves.toBe(true);
		expect(fixture.updateMany).toHaveBeenCalledOnce();
		expect(fixture.$transaction).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({ isolationLevel: "Serializable" }));
	});

	it("reports a different task already bound to the run without overwriting it", async function _RejectsRunOwner()
	{
		const fixture = _Fixture({ workflowTaskId: "33333333-3333-4333-8333-333333333333", workflowTaskName: CONVERSATION_COMPUTER_TURN_TASK.taskName, workflowTaskKey: "44444444-4444-4444-8444-444444444444" });
		await expect(fixture.binder.bind("run-1", 1, _RECEIPT)).resolves.toBe(false);
		expect(fixture.updateMany).not.toHaveBeenCalled();
	});

	it("reports a receipt already owned by another run without writing", async function _RejectsReceiptOwner()
	{
		const fixture = _Fixture(_EMPTY, { id: "run-2" });
		await expect(fixture.binder.bind("run-1", 1, _RECEIPT)).resolves.toBe(false);
		expect(fixture.findFirst).toHaveBeenCalledOnce();
		expect(fixture.updateMany).not.toHaveBeenCalled();
	});

	it("rejects a malformed or different workflow receipt", async function _RejectsMalformed()
	{
		const fixture = _Fixture(_EMPTY);
		await expect(fixture.binder.bind("run-1", 1, { ..._RECEIPT, taskName: "other-task" })).rejects.toThrow("admitted conversation turn task receipt");
		await expect(fixture.binder.bind("run-1", 0, _RECEIPT)).rejects.toThrow("exact run attempt");
	});
});
