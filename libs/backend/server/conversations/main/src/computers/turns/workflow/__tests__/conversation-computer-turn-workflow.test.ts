import { describe, expect, it, vi } from "vitest";

import { WorkflowTaskRetryableError, type IWorkflowTaskContext, type IWorkflowTaskDefinition } from "@opencrane/backend/server/infra/workflows/contract";
import { __FakeWorkflowEngine } from "@opencrane/backend/server/infra/workflows/testing";
import { CONVERSATION_COMPUTER_TURN_MAXIMUM_ATTEMPTS, CONVERSATION_COMPUTER_TURN_TASK } from "../conversation-computer-turn-task";
import type { ConversationComputerTurnTaskInput } from "../conversation-computer-turn-workflow.types";
import { _RegisterConversationComputerTurnWorkflow } from "../conversation-computer-turn-workflow";

const _TASK = { taskId: "31c1f1dc-0010-4f13-9c2f-d3841ffd6651", taskName: CONVERSATION_COMPUTER_TURN_TASK.taskName, idempotencyKey: "41c1f1dc-0010-4f13-9c2f-d3841ffd6651" };
const _INPUT: ConversationComputerTurnTaskInput = { siloId: "silo-1", computerId: "computer-1", leaseId: "lease-1", leaseGeneration: 2, activationEventId: _TASK.idempotencyKey, causationId: "message-1", causationPosition: "2" };
const _TURN = { bootstrapId: "turn-1", siloId: "silo-1", binding: { conversationId: "conversation-1" }, latestPendingEntryId: _INPUT.causationId, latestPendingEntryPosition: _INPUT.causationPosition, compile: { runId: "run-1", attempt: 1 } };

/** Capture the registered definition and expose deterministic durable-wait seams. */
function _Fixture(progress: readonly Record<string, unknown>[], cacheCheckpoints = false)
{
	let definition!: IWorkflowTaskDefinition<ConversationComputerTurnTaskInput, unknown>;
	const execution = { register: vi.fn(function _Register(value) { definition = value; }) };
	const authority = { start: vi.fn().mockResolvedValue(_TURN), advance: vi.fn() };
	for (const result of progress)
		authority.advance.mockResolvedValueOnce(result);
	const receipts = { bind: vi.fn().mockResolvedValue(true) };
	const approvalNotifications = { publishRequested: vi.fn().mockResolvedValue("published") };
	const toolDispatch = { tryExecute: vi.fn().mockResolvedValue(false), settleExhausted: vi.fn().mockResolvedValue(true) };
	const checkpoints = new Map<string, unknown>();
	_RegisterConversationComputerTurnWorkflow(execution as never, { approvalNotifications, authority: authority as never, receipts, toolDispatch, siloId: "silo-1" });
	const context = { task: _TASK, attempt: 1, checkpoint: vi.fn(async function _Checkpoint(step, operation)
	{
		if (!cacheCheckpoints)
			return operation();
		if (!checkpoints.has(step.stepName))
			checkpoints.set(step.stepName, await operation());
		return checkpoints.get(step.stepName);
	}), spawnChild: vi.fn(), awaitChild: vi.fn(), sleepUntil: vi.fn().mockResolvedValue(undefined), waitForEvent: vi.fn().mockResolvedValue({ eventName: "tool-result:tool-1", payload: {} }) } as unknown as IWorkflowTaskContext;
	return { approvalNotifications, authority, context, definition, receipts, toolDispatch };
}

describe("conversation computer turn workflow", function _Suite()
{
	it("waits separately for the captured file after the tool event has already arrived", async function _FileWake()
	{
		const deadline = Date.now() + 30_000;
		const fixture = _Fixture([{ outcome: "tool_pending", toolInvocationId: "tool-1" }, { outcome: "generated_file_pending", operationId: "file-1", notAfterEpochMs: deadline }, { outcome: "completed" }]);
		await expect(fixture.definition.run(fixture.context, _INPUT)).resolves.toEqual({ outcome: "completed", turnId: "turn-1" });
		expect(fixture.context.waitForEvent).toHaveBeenNthCalledWith(1, "tool-result:tool-1");
		expect(fixture.context.waitForEvent).toHaveBeenNthCalledWith(2, "generated-output:file-1", { timeoutAt: new Date(deadline) });
		expect(fixture.authority.advance).toHaveBeenCalledTimes(3);
		expect(fixture.context.checkpoint).toHaveBeenCalledExactlyOnceWith({ stepName: "dispatch-mcp-invocation:tool-1" }, expect.any(Function));
		expect(fixture.toolDispatch.tryExecute).toHaveBeenCalledExactlyOnceWith({ siloId: "silo-1", runId: "run-1", attempt: 1, toolInvocationId: "tool-1" });
		expect(fixture.context.sleepUntil).not.toHaveBeenCalled();
	});

	it("reloads saved authority after the file wait reaches its unchanged deadline", async function _FileDeadline()
	{
		const deadline = Date.now() + 30_000;
		const fixture = _Fixture([{ outcome: "generated_file_pending", operationId: "file-1", notAfterEpochMs: deadline }, { outcome: "authority_ended" }]);
		const wait = fixture.context.waitForEvent as unknown as ReturnType<typeof vi.fn>;
		wait.mockResolvedValueOnce({ eventName: "generated-output:file-1", payload: null, timedOut: true });
		await expect(fixture.definition.run(fixture.context, _INPUT)).resolves.toEqual({ outcome: "authority_ended", turnId: "turn-1" });
		expect(wait).toHaveBeenCalledExactlyOnceWith("generated-output:file-1", { timeoutAt: new Date(deadline) });
	});

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
		expect(fixture.toolDispatch.tryExecute).toHaveBeenCalledExactlyOnceWith({ siloId: "silo-1", runId: "run-1", attempt: 1, toolInvocationId: "tool-1" });
		expect(fixture.authority.advance).toHaveBeenCalledTimes(2);
	});

	it("reads a saved remote result immediately after server dispatch completes", async function _RemoteToolCompletion()
	{
		const fixture = _Fixture([{ outcome: "tool_pending", toolInvocationId: "tool-1" }, { outcome: "completed" }]);
		fixture.toolDispatch.tryExecute.mockResolvedValue(true);

		await expect(fixture.definition.run(fixture.context, _INPUT)).resolves.toEqual({ outcome: "completed", turnId: "turn-1" });

		expect(fixture.toolDispatch.tryExecute).toHaveBeenCalledExactlyOnceWith({ siloId: "silo-1", runId: "run-1", attempt: 1, toolInvocationId: "tool-1" });
		expect(fixture.context.waitForEvent).not.toHaveBeenCalled();
		expect(fixture.authority.advance).toHaveBeenCalledTimes(2);
	});

	it("settles remote work on the final retry and re-reads the authoritative turn", async function _RemoteExhaustion()
	{
		const fixture = _Fixture([{ outcome: "tool_pending", toolInvocationId: "tool-1" }, { outcome: "authority_ended" }]);
		fixture.toolDispatch.tryExecute.mockRejectedValue(new WorkflowTaskRetryableError("remote dependency unavailable"));
		(fixture.context as unknown as { attempt: number }).attempt = CONVERSATION_COMPUTER_TURN_MAXIMUM_ATTEMPTS;

		await expect(fixture.definition.run(fixture.context, _INPUT)).resolves.toEqual({ outcome: "authority_ended", turnId: "turn-1" });

		expect(fixture.toolDispatch.tryExecute).toHaveBeenCalledOnce();
		expect(fixture.toolDispatch.settleExhausted).toHaveBeenCalledExactlyOnceWith({ siloId: "silo-1", runId: "run-1", attempt: 1, toolInvocationId: "tool-1" });
		expect(fixture.context.waitForEvent).not.toHaveBeenCalled();
		expect(fixture.authority.advance).toHaveBeenCalledTimes(2);
	});

	it("waits on the separate approval event before terminal result delivery", async function _ApprovalWake()
	{
		const fixture = _Fixture([{ outcome: "tool_pending", toolInvocationId: "tool-1", waitFor: "approval" }, { outcome: "completed" }]);
		await expect(fixture.definition.run(fixture.context, _INPUT)).resolves.toEqual({ outcome: "completed", turnId: "turn-1" });
		expect(fixture.context.waitForEvent).toHaveBeenCalledExactlyOnceWith("tool-approval:tool-1");
		expect(fixture.approvalNotifications.publishRequested).toHaveBeenCalledExactlyOnceWith({ bootstrapId: "turn-1", siloId: "silo-1", conversationId: "conversation-1", runId: "run-1", attempt: 1, approvalId: "tool-1" });
		expect(fixture.approvalNotifications.publishRequested.mock.invocationCallOrder[0]).toBeLessThan((fixture.context.waitForEvent as unknown as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]!);
		expect(fixture.toolDispatch.tryExecute).not.toHaveBeenCalled();
		expect(fixture.authority.advance).toHaveBeenCalledTimes(2);
	});

	it("keeps approval publication checkpoints distinct per invocation while replaying the same ID", async function _ApprovalCheckpointIdentity()
	{
		const fixture = _Fixture([
			{ outcome: "tool_pending", toolInvocationId: "tool-1", waitFor: "approval" },
			{ outcome: "tool_pending", toolInvocationId: "tool-1", waitFor: "approval" },
			{ outcome: "tool_pending", toolInvocationId: "tool-2", waitFor: "approval" },
			{ outcome: "completed" },
		], true);

		await expect(fixture.definition.run(fixture.context, _INPUT)).resolves.toEqual({ outcome: "completed", turnId: "turn-1" });

		expect(fixture.approvalNotifications.publishRequested).toHaveBeenCalledTimes(2);
		expect(fixture.approvalNotifications.publishRequested).toHaveBeenNthCalledWith(1, expect.objectContaining({ approvalId: "tool-1" }));
		expect(fixture.approvalNotifications.publishRequested).toHaveBeenNthCalledWith(2, expect.objectContaining({ approvalId: "tool-2" }));
		expect(fixture.context.checkpoint).toHaveBeenNthCalledWith(1, { stepName: "publish-tool-approval-requested:tool-1" }, expect.any(Function));
		expect(fixture.context.checkpoint).toHaveBeenNthCalledWith(2, { stepName: "publish-tool-approval-requested:tool-1" }, expect.any(Function));
		expect(fixture.context.checkpoint).toHaveBeenNthCalledWith(3, { stepName: "publish-tool-approval-requested:tool-2" }, expect.any(Function));
	});

	it("keeps dispatch checkpoints distinct per invocation while replaying the same ID", async function _DispatchCheckpointIdentity()
	{
		const fixture = _Fixture([
			{ outcome: "tool_pending", toolInvocationId: "tool-1" },
			{ outcome: "tool_pending", toolInvocationId: "tool-1" },
			{ outcome: "tool_pending", toolInvocationId: "tool-2" },
			{ outcome: "completed" },
		], true);

		await expect(fixture.definition.run(fixture.context, _INPUT)).resolves.toEqual({ outcome: "completed", turnId: "turn-1" });

		expect(fixture.toolDispatch.tryExecute).toHaveBeenCalledTimes(2);
		expect(fixture.toolDispatch.tryExecute).toHaveBeenNthCalledWith(1, expect.objectContaining({ toolInvocationId: "tool-1" }));
		expect(fixture.toolDispatch.tryExecute).toHaveBeenNthCalledWith(2, expect.objectContaining({ toolInvocationId: "tool-2" }));
		expect(fixture.context.checkpoint).toHaveBeenNthCalledWith(1, { stepName: "dispatch-mcp-invocation:tool-1" }, expect.any(Function));
		expect(fixture.context.checkpoint).toHaveBeenNthCalledWith(2, { stepName: "dispatch-mcp-invocation:tool-1" }, expect.any(Function));
		expect(fixture.context.checkpoint).toHaveBeenNthCalledWith(3, { stepName: "dispatch-mcp-invocation:tool-2" }, expect.any(Function));
	});

	it("resumes a saved approval through the workflow engine and admits one executor on replay", async function _ApprovalEngineJourney()
	{
		const execution = new __FakeWorkflowEngine();
		const state = { approved: false, advances: 0, executions: 0 };
		const authority = {
			start: vi.fn().mockResolvedValue(_TURN),
			advance: vi.fn(async function _Advance()
			{
				state.advances++;
				if (!state.approved)
					return { outcome: "tool_pending" as const, toolInvocationId: "tool-approval", waitFor: "approval" as const };
				state.executions++;
				return { outcome: "completed" as const };
			}),
		};
		const approvalNotifications = { publishRequested: vi.fn().mockResolvedValue("published") };
		const toolDispatch = { tryExecute: vi.fn().mockResolvedValue(false), settleExhausted: vi.fn().mockResolvedValue(true) };
		_RegisterConversationComputerTurnWorkflow(execution, { approvalNotifications, authority, receipts: { bind: vi.fn().mockResolvedValue(true) }, toolDispatch, siloId: "silo-1" });
		const task = await execution.spawn({ client: {} }, { taskName: CONVERSATION_COMPUTER_TURN_TASK.taskName, idempotencyKey: _TASK.idempotencyKey, input: _INPUT });
		const running = execution._DrainPendingTasks();
		await Promise.resolve();
		await Promise.resolve();
		expect(state.advances).toBe(1);
		state.approved = true;
		await execution.emitEvent(task, { eventName: "tool-approval:tool-approval", payload: { owner: "user-1" } });
		await running;
		expect(state.executions).toBe(1);
		expect(approvalNotifications.publishRequested).toHaveBeenCalledTimes(1);
		expect(toolDispatch.tryExecute).not.toHaveBeenCalled();
		await execution._DrainPendingTasks();
		expect(state.executions).toBe(1);
	});

	it("re-enters the saved turn when its approval wait reaches the durable deadline", async function _ApprovalTimeout()
	{
		const fixture = _Fixture([{ outcome: "tool_pending", toolInvocationId: "tool-1", waitFor: "approval", waitUntilEpochMs: Date.now() + 30_000 }, { outcome: "completed" }]);
		const waitForEvent = fixture.context.waitForEvent as unknown as ReturnType<typeof vi.fn>;
		waitForEvent.mockResolvedValueOnce({ eventName: "tool-approval:tool-1", payload: null, timedOut: true });
		await expect(fixture.definition.run(fixture.context, _INPUT)).resolves.toEqual({ outcome: "completed", turnId: "turn-1" });
		expect(fixture.context.waitForEvent).toHaveBeenCalledWith("tool-approval:tool-1", { timeoutAt: expect.any(Date) });
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
