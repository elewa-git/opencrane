import type { IWorkflowTaskContext, IWorkflowTaskReceipt } from "@opencrane/backend/server/infra/workflows/contract";
import { RoutineFiringTrigger } from "@opencrane/models/agents";
import { describe, expect, it, vi } from "vitest";

import { __CreateRoutineWorkflowDefinitions } from "../routine-workflow";
import type { RoutineInstructionEnvelope } from "../routine-instruction.types";
import { RoutineOccurrenceStage, type RoutineOccurrencePreparationInput, type RoutineWorkflowDependencies, type RoutineWorkflowPersistence } from "../routine-workflow.types";

/** Exact task receipt used as the occurrence persistence fence. */
const _TASK: IWorkflowTaskReceipt = { taskId: "task-1", taskName: "agents.routines.occurrence/v1", idempotencyKey: "occurrence-1" };
/** Encrypted instruction loaded from the immutable revision. */
const _ENVELOPE: RoutineInstructionEnvelope = { keyId: "key-1", nonce: new Uint8Array([1]), ciphertext: new Uint8Array([2]), authTag: new Uint8Array([3]), ciphertextDigest: `sha256:${"a".repeat(64)}` };

/** Builds the durable occurrence input returned under the task fence. */
function _savedOccurrence(): RoutineOccurrencePreparationInput
{
	return {
		siloId: "silo-1", firingId: "firing-1", routineId: "routine-1", routineRevision: 2, task: _TASK,
		admittedRunId: null, trigger: RoutineFiringTrigger.Automatic, scheduledSlot: "2026-09-25T09:00:00.000Z",
		conversationId: "conversation-1", destinationConversationId: "conversation-source", selectedManagedServiceId: "service-1",
		requesterPrincipalId: "principal-1", requesterIssuer: "https://issuer.example", requesterSubjectId: "subject-1", requesterAuthenticatedAt: "2026-09-24T12:00:00.000Z",
		audiencePrincipalIds: ["principal-1", "principal-2"], instruction: _ENVELOPE,
	};
}

describe("routine durable workflows", function _suite()
{
	it("ends the occurrence when preparation commits a refusal", async function _PreparationRefusal()
	{
		const persistence = { authorizeOccurrenceStage: vi.fn().mockResolvedValue(_savedOccurrence()), recordPreparation: vi.fn(), recordActivation: vi.fn(), bindAdmittedRun: vi.fn() } as unknown as RoutineWorkflowPersistence;
		const dependencies = { persistence, cipher: { decrypt: vi.fn().mockResolvedValue("Do the work."), encrypt: vi.fn() }, preparation: { prepare: vi.fn().mockResolvedValue(null) }, activation: { activate: vi.fn() }, runAdmission: { admit: vi.fn() } } as unknown as RoutineWorkflowDependencies;
		const context = { task: _TASK, attempt: 1, checkpoint: vi.fn(async function _Checkpoint(_step, operation) { return await operation(); }) } as unknown as IWorkflowTaskContext;
		await expect(__CreateRoutineWorkflowDefinitions(dependencies).occurrence.run(context, { siloId: "silo-1", firingId: "firing-1", routineId: "routine-1", routineRevision: 2 })).resolves.toEqual({ firingId: "firing-1", runId: null });
		expect(persistence.recordPreparation).not.toHaveBeenCalled();
		expect(dependencies.activation.activate).not.toHaveBeenCalled();
		expect(dependencies.runAdmission.admit).not.toHaveBeenCalled();
	});

	it("saves preparation and activation receipts before admitting the exact root run", async function _occurrence()
	{
		const events: string[] = [];
		const preparation = { receiptId: "preparation-1", historyReference: "history-1", digest: `sha256:${"b".repeat(64)}` as const };
		const activation = { receiptId: "activation-1", computerReference: "computer-1", digest: `sha256:${"c".repeat(64)}` as const };
		const admission = { runId: "run-1", inputSnapshotDigest: `sha256:${"d".repeat(64)}` as const, runTask: { taskId: "run-task-1", taskName: "agents.runs.execute/v1", idempotencyKey: "run-1" } };
		const persistence = {
			authorizeOccurrenceStage: vi.fn().mockResolvedValue(_savedOccurrence()),
			recordPreparation: vi.fn(async (_identity, receipt) => { events.push("save-preparation"); return receipt; }),
			recordActivation: vi.fn(async (_identity, receipt) => { events.push("save-activation"); return receipt; }),
			bindAdmittedRun: vi.fn(async () => { events.push("bind-run"); }),
		} as unknown as RoutineWorkflowPersistence;
		const dependencies = {
			persistence,
			cipher: { decrypt: vi.fn().mockResolvedValue("Do the work."), encrypt: vi.fn() },
			preparation: { prepare: vi.fn(async () => { events.push("prepare"); return preparation; }) },
			activation: { activate: vi.fn(async () => { events.push("activate"); return activation; }) },
			runAdmission: { admit: vi.fn(async () => { events.push("admit-run"); return admission; }) },
			ids: { routineId: vi.fn(), revisionId: vi.fn(), firingId: vi.fn(), conversationId: vi.fn(), commandReceiptId: vi.fn() },
		} as unknown as RoutineWorkflowDependencies;
		const context = { task: _TASK, attempt: 1, checkpoint: vi.fn(async (_step, operation) => await operation()), waitForEvent: vi.fn(), spawnChild: vi.fn(), awaitChild: vi.fn(), sleepUntil: vi.fn() } as unknown as IWorkflowTaskContext;

		const result = await __CreateRoutineWorkflowDefinitions(dependencies).occurrence.run(context, { siloId: "silo-1", firingId: "firing-1", routineId: "routine-1", routineRevision: 2 });

		expect(result).toEqual({ firingId: "firing-1", runId: "run-1" });
		expect(events).toEqual(["prepare", "save-preparation", "activate", "save-activation", "admit-run", "bind-run"]);
		expect(persistence.authorizeOccurrenceStage).toHaveBeenNthCalledWith(1, expect.objectContaining({ firingId: "firing-1", task: _TASK }), RoutineOccurrenceStage.Preparation);
		expect(persistence.authorizeOccurrenceStage).toHaveBeenNthCalledWith(2, expect.objectContaining({ firingId: "firing-1", task: _TASK }), RoutineOccurrenceStage.Activation);
		expect(persistence.authorizeOccurrenceStage).toHaveBeenNthCalledWith(3, expect.objectContaining({ firingId: "firing-1", task: _TASK }), RoutineOccurrenceStage.RunAdmission);
		const { instruction: _encryptedInstruction, ...occurrence } = _savedOccurrence();
		expect(dependencies.cipher.decrypt).toHaveBeenCalledOnce();
		expect(dependencies.preparation.prepare).toHaveBeenCalledExactlyOnceWith({ ...occurrence, instruction: "Do the work." });
		expect(dependencies.activation.activate).toHaveBeenCalledExactlyOnceWith(occurrence, preparation);
		expect(dependencies.runAdmission.admit).toHaveBeenCalledExactlyOnceWith({ ...occurrence, preparation, activation });
		for (const laterCommand of [vi.mocked(dependencies.activation.activate).mock.calls[0]![0], vi.mocked(dependencies.runAdmission.admit).mock.calls[0]![0]])
		{
			expect(laterCommand).not.toHaveProperty("instruction");
			expect(JSON.stringify(laterCommand)).not.toMatch(/ciphertext|authTag|nonce|keyId/u);
		}
	});

	it("replays saved preparation without decrypting or exposing instruction content to later stages", async function _PreparationReplay()
	{
		const preparation = { receiptId: "preparation-1", historyReference: "history-1", digest: `sha256:${"b".repeat(64)}` as const };
		const activation = { receiptId: "activation-1", computerReference: "computer-1", digest: `sha256:${"c".repeat(64)}` as const };
		const admission = { runId: "run-1", inputSnapshotDigest: `sha256:${"d".repeat(64)}` as const, runTask: { taskId: "run-task-1", taskName: "agents.runs.execute/v1", idempotencyKey: "run-1" } };
		const persistence = {
			authorizeOccurrenceStage: vi.fn().mockResolvedValue(_savedOccurrence()),
			recordPreparation: vi.fn().mockResolvedValue(preparation),
			recordActivation: vi.fn().mockResolvedValue(activation),
			bindAdmittedRun: vi.fn(),
		} as unknown as RoutineWorkflowPersistence;
		const dependencies = {
			persistence,
			cipher: { decrypt: vi.fn(), encrypt: vi.fn() },
			preparation: { prepare: vi.fn() },
			activation: { activate: vi.fn().mockResolvedValue(activation) },
			runAdmission: { admit: vi.fn().mockResolvedValue(admission) },
		} as unknown as RoutineWorkflowDependencies;
		const checkpoint = vi.fn().mockResolvedValueOnce(preparation).mockImplementation(async function _Execute(_step, operation) { return await operation(); });
		const context = { task: _TASK, attempt: 2, checkpoint, waitForEvent: vi.fn(), spawnChild: vi.fn(), awaitChild: vi.fn(), sleepUntil: vi.fn() } as unknown as IWorkflowTaskContext;

		await expect(__CreateRoutineWorkflowDefinitions(dependencies).occurrence.run(context, { siloId: "silo-1", firingId: "firing-1", routineId: "routine-1", routineRevision: 2 })).resolves.toEqual({ firingId: "firing-1", runId: "run-1" });

		expect(dependencies.cipher.decrypt).not.toHaveBeenCalled();
		expect(dependencies.preparation.prepare).not.toHaveBeenCalled();
		const { instruction: _encryptedInstruction, ...occurrence } = _savedOccurrence();
		expect(dependencies.activation.activate).toHaveBeenCalledExactlyOnceWith(occurrence, preparation);
		expect(dependencies.runAdmission.admit).toHaveBeenCalledExactlyOnceWith({ ...occurrence, preparation, activation });
		for (const laterCommand of [vi.mocked(dependencies.activation.activate).mock.calls[0]![0], vi.mocked(dependencies.runAdmission.admit).mock.calls[0]![0]])
		{
			expect(laterCommand).not.toHaveProperty("instruction");
			expect(JSON.stringify(laterCommand)).not.toMatch(/ciphertext|authTag|nonce|keyId/u);
		}
	});

	it("stops before a later external stage after a durable authority refusal", async function _refusal()
	{
		const saved = _savedOccurrence();
		const preparation = { receiptId: "preparation-1", historyReference: "history-1", digest: `sha256:${"b".repeat(64)}` as const };
		const persistence = {
			authorizeOccurrenceStage: vi.fn().mockResolvedValueOnce(saved).mockResolvedValueOnce(null),
			recordPreparation: vi.fn().mockResolvedValue(preparation),
		} as unknown as RoutineWorkflowPersistence;
		const dependencies = {
			persistence,
			cipher: { decrypt: vi.fn().mockResolvedValue("Do the work."), encrypt: vi.fn() },
			preparation: { prepare: vi.fn().mockResolvedValue(preparation) },
			activation: { activate: vi.fn() },
			runAdmission: { admit: vi.fn() },
		} as unknown as RoutineWorkflowDependencies;
		const context = { task: _TASK, attempt: 1, checkpoint: vi.fn(async (_step, operation) => await operation()), waitForEvent: vi.fn(), spawnChild: vi.fn(), awaitChild: vi.fn(), sleepUntil: vi.fn() } as unknown as IWorkflowTaskContext;

		await expect(__CreateRoutineWorkflowDefinitions(dependencies).occurrence.run(context, { siloId: "silo-1", firingId: "firing-1", routineId: "routine-1", routineRevision: 2 })).resolves.toEqual({ firingId: "firing-1", runId: null });

		expect(persistence.recordPreparation).toHaveBeenCalledTimes(1);
		expect(dependencies.activation.activate).not.toHaveBeenCalled();
		expect(dependencies.runAdmission.admit).not.toHaveBeenCalled();
	});

	it("rejects a malformed run-admission checkpoint before binding the run", async function _InvalidRunAdmission()
	{
		const preparation = { receiptId: "preparation-1", historyReference: "history-1", digest: `sha256:${"b".repeat(64)}` as const };
		const activation = { receiptId: "activation-1", computerReference: "computer-1", digest: `sha256:${"c".repeat(64)}` as const };
		const persistence = {
			authorizeOccurrenceStage: vi.fn().mockResolvedValue(_savedOccurrence()),
			recordPreparation: vi.fn().mockResolvedValue(preparation),
			recordActivation: vi.fn().mockResolvedValue(activation),
			bindAdmittedRun: vi.fn(),
		} as unknown as RoutineWorkflowPersistence;
		const dependencies = {
			persistence,
			cipher: { decrypt: vi.fn().mockResolvedValue("Do the work."), encrypt: vi.fn() },
			preparation: { prepare: vi.fn().mockResolvedValue(preparation) },
			activation: { activate: vi.fn().mockResolvedValue(activation) },
			runAdmission: { admit: vi.fn().mockResolvedValue({ runId: "run-1", inputSnapshotDigest: "invalid", runTask: { taskId: "task-1", taskName: "agents.runs.execute/v1", idempotencyKey: "run-1" } }) },
		} as unknown as RoutineWorkflowDependencies;
		const context = { task: _TASK, attempt: 1, checkpoint: vi.fn(async (_step, operation) => await operation()), waitForEvent: vi.fn(), spawnChild: vi.fn(), awaitChild: vi.fn(), sleepUntil: vi.fn() } as unknown as IWorkflowTaskContext;

		await expect(__CreateRoutineWorkflowDefinitions(dependencies).occurrence.run(context, { siloId: "silo-1", firingId: "firing-1", routineId: "routine-1", routineRevision: 2 })).rejects.toThrow("routine run admission receipt is invalid");
		expect(persistence.bindAdmittedRun).not.toHaveBeenCalled();
	});

	it("repairs a committed run backlink before returning from replay", async function _repairRunBinding()
	{
		const persistence = {
			authorizeOccurrenceStage: vi.fn().mockResolvedValue({ ..._savedOccurrence(), admittedRunId: "run-1" }),
			bindAdmittedRun: vi.fn(),
		} as unknown as RoutineWorkflowPersistence;
		const dependencies = { persistence, cipher: { decrypt: vi.fn() }, preparation: { prepare: vi.fn() }, activation: { activate: vi.fn() }, runAdmission: { admit: vi.fn() } } as unknown as RoutineWorkflowDependencies;
		const context = { task: _TASK } as unknown as IWorkflowTaskContext;

		await expect(__CreateRoutineWorkflowDefinitions(dependencies).occurrence.run(context, { siloId: "silo-1", firingId: "firing-1", routineId: "routine-1", routineRevision: 2 })).resolves.toEqual({ firingId: "firing-1", runId: "run-1" });

		expect(persistence.bindAdmittedRun).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ firingId: "firing-1", task: _TASK }), "run-1");
		expect(dependencies.cipher.decrypt).not.toHaveBeenCalled();
		expect(dependencies.runAdmission.admit).not.toHaveBeenCalled();
	});

	it("durably sleeps to the saved slot before selecting automatic work", async function _schedule()
	{
		const persistence = { fireAutomatic: vi.fn().mockResolvedValue(null) } as unknown as RoutineWorkflowPersistence;
		const dependencies = { persistence, ids: { firingId: () => "firing-1", conversationId: () => "conversation-1" } } as unknown as RoutineWorkflowDependencies;
		const context = { task: _TASK, sleepUntil: vi.fn().mockResolvedValue(undefined) } as unknown as IWorkflowTaskContext;
		const definitions = __CreateRoutineWorkflowDefinitions(dependencies);

		await expect(definitions.schedule.run(context, { siloId: "silo-1", routineId: "routine-1", routineRevision: 2, slotEpochMs: Date.parse("2026-09-25T09:00:00.000Z") })).resolves.toEqual({ firingId: null });

		expect(context.sleepUntil).toHaveBeenCalledExactlyOnceWith(new Date("2026-09-25T09:00:00.000Z"), "routine-schedule-slot");
		expect(persistence.fireAutomatic).toHaveBeenCalledWith(expect.objectContaining({ siloId: "silo-1", routineId: "routine-1", routineRevision: 2, scheduleTask: _TASK }));
	});
});
