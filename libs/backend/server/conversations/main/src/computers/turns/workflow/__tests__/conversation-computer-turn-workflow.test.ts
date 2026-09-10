import { describe, expect, it, vi } from "vitest";

import type { IWorkflowTaskContext, IWorkflowTaskDefinition } from "@opencrane/backend/server/infra/workflows/contract";
import { CONVERSATION_COMPUTER_TURN_TASK } from "../conversation-computer-turn-task";
import type { ConversationComputerTurnTaskInput } from "../conversation-computer-turn-workflow.types";
import { _RegisterConversationComputerTurnWorkflow } from "../conversation-computer-turn-workflow";

const _TASK = { taskId: "31c1f1dc-0010-4f13-9c2f-d3841ffd6651", taskName: CONVERSATION_COMPUTER_TURN_TASK.taskName, idempotencyKey: "41c1f1dc-0010-4f13-9c2f-d3841ffd6651" };
const _INPUT: ConversationComputerTurnTaskInput = { siloId: "silo-1", computerId: "computer-1", leaseId: "lease-1", leaseGeneration: 2, activationEventId: _TASK.idempotencyKey, causationId: "message-1", causationPosition: "2" };
const _TURN = { bootstrapId: "turn-1", latestPendingEntryId: _INPUT.causationId, latestPendingEntryPosition: _INPUT.causationPosition, compile: { runId: "run-1", attempt: 1 } };

/** Capture the registered definition and expose deterministic durable-wait seams. */
function _Fixture(progress: readonly Record<string, unknown>[])
{
	let definition!: IWorkflowTaskDefinition<ConversationComputerTurnTaskInput, unknown>;
	const execution = { register: vi.fn(function _Register(value) { definition = value; }) };
	const authority = { start: vi.fn().mockResolvedValue(_TURN), advance: vi.fn() };
	for (const result of progress)
		authority.advance.mockResolvedValueOnce(result);
	const receipts = { bind: vi.fn().mockResolvedValue(true) };
	_RegisterConversationComputerTurnWorkflow(execution as never, { authority: authority as never, receipts, siloId: "silo-1" });
	const context = { task: _TASK, attempt: 1, checkpoint: vi.fn(), spawnChild: vi.fn(), awaitChild: vi.fn(), sleepUntil: vi.fn().mockResolvedValue(undefined), waitForEvent: vi.fn().mockResolvedValue({ eventName: "tool-result:tool-1", payload: {} }) } as unknown as IWorkflowTaskContext;
	return { authority, context, definition, receipts };
}

describe("conversation computer turn workflow", function _Suite()
{
	it("re-enters saved model progress after its fixed deadline without dispatch authority in a checkpoint", async function _DeadlineRecovery()
	{
		const deadline = Date.now() + 20_000;
		const fixture = _Fixture([{ outcome: "model_pending", ordinal: 1, notBeforeEpochMs: deadline }, { outcome: "response_unavailable" }]);
		await expect(fixture.definition.run(fixture.context, _INPUT)).resolves.toEqual({ outcome: "response_unavailable", turnId: "turn-1" });
		expect(fixture.context.sleepUntil).toHaveBeenCalledExactlyOnceWith(new Date(deadline), "model-1-deadline");
		expect(fixture.context.checkpoint).not.toHaveBeenCalled();
		expect(fixture.authority.advance).toHaveBeenCalledTimes(2);
	});

	it("waits for the exact terminal tool event and then completes from saved state", async function _ToolWake()
	{
		const fixture = _Fixture([{ outcome: "tool_pending", toolInvocationId: "tool-1" }, { outcome: "completed" }]);
		await expect(fixture.definition.run(fixture.context, _INPUT)).resolves.toEqual({ outcome: "completed", turnId: "turn-1" });
		expect(fixture.context.waitForEvent).toHaveBeenCalledExactlyOnceWith("tool-result:tool-1");
		expect(fixture.authority.advance).toHaveBeenCalledTimes(2);
	});

	it("lets only the task bound to the run attempt continue", async function _CompetingActivation()
	{
		const fixture = _Fixture([]);
		fixture.receipts.bind.mockResolvedValue(false);
		await expect(fixture.definition.run(fixture.context, _INPUT)).resolves.toEqual({ outcome: "superseded", turnId: "turn-1" });
		expect(fixture.authority.advance).not.toHaveBeenCalled();
	});

	it("waits for an earlier turn to settle before admitting the later activating message", async function _OrderedActivations()
	{
		const fixture = _Fixture([{ outcome: "completed" }]);
		fixture.authority.start.mockReset()
			.mockResolvedValueOnce({ bootstrapId: "turn-0", latestPendingEntryId: "message-0", latestPendingEntryPosition: "1", compile: { runId: "run-0", attempt: 1 } })
			.mockResolvedValueOnce(_TURN);
		await expect(fixture.definition.run(fixture.context, _INPUT)).resolves.toEqual({ outcome: "completed", turnId: "turn-1" });
		expect(fixture.authority.start).toHaveBeenCalledTimes(2);
		expect(fixture.context.sleepUntil).toHaveBeenCalledWith(expect.any(Date), "predecessor-1");
		expect(fixture.receipts.bind).toHaveBeenCalledExactlyOnceWith("run-1", 1, _TASK);
		expect(fixture.authority.advance).toHaveBeenCalledExactlyOnceWith("turn-1");
	});

	it("ends an older activation after a later message already owns the active turn", async function _SupersededActivation()
	{
		const fixture = _Fixture([]);
		fixture.authority.start.mockResolvedValue({ ..._TURN, latestPendingEntryId: "message-3", latestPendingEntryPosition: "3" });
		await expect(fixture.definition.run(fixture.context, _INPUT)).resolves.toEqual({ outcome: "superseded", turnId: "turn-1" });
		expect(fixture.receipts.bind).not.toHaveBeenCalled();
		expect(fixture.authority.advance).not.toHaveBeenCalled();
	});
});
