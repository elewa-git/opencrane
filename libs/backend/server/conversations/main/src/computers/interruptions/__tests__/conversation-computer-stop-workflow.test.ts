import { describe, expect, it, vi } from "vitest";
import type { IWorkflowTaskDefinition } from "@opencrane/backend/server/infra/workflows/contract";

import { _RegisterConversationComputerStopWorkflow } from "../conversation-computer-stop-workflow";
import { CONVERSATION_COMPUTER_STOP_TASK } from "../conversation-computer-stop-task";
import { ConversationComputerStopAdmissionKinds, ConversationComputerStopDecisions, type ConversationComputerStopTaskInput, type ConversationComputerStopTaskResult } from "../conversation-computer-stop.types";

const _INPUT: ConversationComputerStopTaskInput = { command: { commandId: "stop-1", siloId: "silo-1", conversationId: "conversation-1", computerId: "computer-1", generation: 2, causationId: "message-stop", causationPosition: "8", requester: { principalId: "principal-1", subjectId: "user-1", issuer: "issuer", authenticatedAt: "2026-09-11T10:00:00.000Z" } }, target: { bootstrapId: "bootstrap-1", runId: "run-1", attempt: 1, leaseId: "lease-1", leaseGeneration: 2 }, commandDigest: "sha256:command", originalTurnTask: { taskId: "turn-task-1", taskName: "conversation-computer-turn", idempotencyKey: "activation-1" } };

function _Fixture(decision: ConversationComputerStopDecisions, cleanup: Array<{ activeClaimCount: number; nextClaimExpiryAt: string | null }> = [{ activeClaimCount: 0, nextClaimExpiryAt: null }])
{
	let definition!: IWorkflowTaskDefinition<ConversationComputerStopTaskInput, ConversationComputerStopTaskResult>;
	const admission = { kind: ConversationComputerStopAdmissionKinds.Target, ..._INPUT, cancellationTask: { taskId: "stop-task-1", taskName: CONVERSATION_COMPUTER_STOP_TASK.taskName, idempotencyKey: "stop-1" }, requestedAt: "2026-09-11T10:00:01.000Z", authorizationDecisionDigest: "sha256:decision" } as const;
	const workflows = { register: vi.fn(function _Register(value) { definition = value; }), cancel: vi.fn().mockResolvedValue(_INPUT.originalTurnTask) };
	const lifecycle = { recordDecision: vi.fn().mockResolvedValue(undefined), cleanup: vi.fn().mockImplementation(async function _Cleanup() { return cleanup.shift()!; }), finalize: vi.fn().mockResolvedValue(true) };
	const credentials = { revoke: vi.fn().mockResolvedValue(undefined) };
	_RegisterConversationComputerStopWorkflow(workflows as never, { admissions: { read: vi.fn().mockResolvedValue(admission), admit: vi.fn() }, publisher: { recover: vi.fn(), recoverSelection: vi.fn(), select: vi.fn(), publish: vi.fn().mockResolvedValue({ decision, published: true, outputReceiptDigest: decision === ConversationComputerStopDecisions.OutputWon ? `sha256:${"a".repeat(64)}` : null }) }, lifecycle, credentials });
	const context = { task: admission.cancellationTask, attempt: 1, checkpoint: vi.fn(async (_step, operation) => operation()), sleepUntil: vi.fn().mockResolvedValue(undefined), waitForEvent: vi.fn(), spawnChild: vi.fn(), awaitChild: vi.fn() };
	return { definition, workflows, lifecycle, credentials, context };
}

describe("conversation computer Stop workflow", function _Suite()
{
	it("records output as winner without cancellation effects", async function _OutputWins()
	{
		const fixture = _Fixture(ConversationComputerStopDecisions.OutputWon);
		await expect(fixture.definition.run(fixture.context as never, _INPUT)).resolves.toEqual({ outcome: "output_completed", commandId: "stop-1" });
		expect(fixture.lifecycle.recordDecision).toHaveBeenCalledOnce();
		expect(fixture.workflows.cancel).not.toHaveBeenCalled();
		expect(fixture.credentials.revoke).not.toHaveBeenCalled();
	});

	it("cancels the original task and credential only after cancellation wins", async function _CancellationWins()
	{
		const fixture = _Fixture(ConversationComputerStopDecisions.CancellationWon);
		await expect(fixture.definition.run(fixture.context as never, _INPUT)).resolves.toEqual({ outcome: "cancelled", commandId: "stop-1" });
		expect(fixture.lifecycle.recordDecision.mock.invocationCallOrder[0]).toBeLessThan(fixture.workflows.cancel.mock.invocationCallOrder[0]!);
		expect(fixture.workflows.cancel.mock.invocationCallOrder[0]).toBeLessThan(fixture.credentials.revoke.mock.invocationCallOrder[0]!);
		expect(fixture.lifecycle.finalize).toHaveBeenCalledOnce();
	});

	it("waits for the saved provider claim expiry and repeats cleanup", async function _WaitsForClaim()
	{
		const fixture = _Fixture(ConversationComputerStopDecisions.CancellationWon, [{ activeClaimCount: 1, nextClaimExpiryAt: "2026-09-11T10:01:00.000Z" }, { activeClaimCount: 0, nextClaimExpiryAt: null }]);
		await fixture.definition.run(fixture.context as never, _INPUT);
		expect(fixture.context.sleepUntil).toHaveBeenCalledWith(new Date("2026-09-11T10:01:00.000Z"), "provider-claim-0");
		expect(fixture.lifecycle.cleanup).toHaveBeenCalledTimes(2);
	});

	it("retries an unexpected stale target without recording a terminal SQL result", async function _RetriesStaleTarget()
	{
		const fixture = _Fixture(ConversationComputerStopDecisions.Stale);
		await expect(fixture.definition.run(fixture.context as never, _INPUT)).rejects.toThrow("target arbitration must be retried");
		expect(fixture.lifecycle.recordDecision).not.toHaveBeenCalled();
		expect(fixture.workflows.cancel).not.toHaveBeenCalled();
		expect(fixture.credentials.revoke).not.toHaveBeenCalled();
	});
});
