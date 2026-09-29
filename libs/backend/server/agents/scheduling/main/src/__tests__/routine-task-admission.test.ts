import type { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import type { IWorkflowTaskReceipt, IWorkflowTaskSpawn, IWorkflowTransaction } from "@opencrane/backend/server/infra/workflows/contract";

import { RoutineTaskAdmission } from "../routine-task-admission";
import { ROUTINE_OCCURRENCE_TASK_NAME, ROUTINE_SCHEDULE_TASK_NAME } from "../routine-workflow-contract";
import type { RoutineOccurrenceTaskInput, RoutineScheduleTaskInput } from "../routine-workflow.types";

/** Builds a guarded-engine stand-in that records calls and returns stable task receipts. */
function _fixture()
{
	const receipts = new Map<string, IWorkflowTaskReceipt>();
	const spawn = vi.fn(async function _Spawn(_transaction: IWorkflowTransaction, task: IWorkflowTaskSpawn<unknown>): Promise<IWorkflowTaskReceipt>
	{
		const key = JSON.stringify([task.taskName, task.idempotencyKey]);
		const existing = receipts.get(key);
		if (existing !== undefined)
			return existing;
		const receipt = { taskId: `task-${receipts.size + 1}`, taskName: task.taskName, idempotencyKey: task.idempotencyKey };
		receipts.set(key, receipt);
		return receipt;
	});
	const transaction = { marker: "caller-owned transaction" } as unknown as Prisma.TransactionClient;
	return { admission: new RoutineTaskAdmission<Prisma.TransactionClient>({ spawn }), spawn, transaction };
}

/** Supplies a saved automatic slot without consulting a process clock. */
function _schedule(overrides: Partial<RoutineScheduleTaskInput> = {}): RoutineScheduleTaskInput
{
	return { siloId: "silo-1", routineId: "routine-1", routineRevision: 2, slotEpochMs: 1_790_352_000_000, ...overrides };
}

/** Supplies the immutable identity reserved by the routine repository. */
function _occurrence(overrides: Partial<RoutineOccurrenceTaskInput> = {}): RoutineOccurrenceTaskInput
{
	return { siloId: "silo-1", routineId: "routine-1", routineRevision: 2, firingId: "firing-1", ...overrides };
}

describe("RoutineTaskAdmission", function _Suite()
{
	it("uses the caller transaction and the reviewed task name for a schedule", async function _Schedule()
	{
		const fixture = _fixture();
		const input = _schedule();
		const result = await fixture.admission.admitSchedule(fixture.transaction, input);
		expect(fixture.spawn).toHaveBeenCalledWith({ client: fixture.transaction }, { taskName: ROUTINE_SCHEDULE_TASK_NAME, idempotencyKey: JSON.stringify([input.siloId, input.routineId, input.routineRevision, input.slotEpochMs]), input });
		expect(fixture.spawn.mock.calls[0][0].client).toBe(fixture.transaction);
		expect(await fixture.admission.admitSchedule(fixture.transaction, { ...input })).toBe(result);
	});

	it("uses the caller transaction and recovers an occurrence without inventing another firing", async function _Occurrence()
	{
		const fixture = _fixture();
		const input = _occurrence();
		const result = await fixture.admission.admitOccurrence(fixture.transaction, input);
		expect(fixture.spawn).toHaveBeenCalledWith({ client: fixture.transaction }, { taskName: ROUTINE_OCCURRENCE_TASK_NAME, idempotencyKey: JSON.stringify([input.siloId, input.firingId]), input });
		expect(fixture.spawn.mock.calls[0][0].client).toBe(fixture.transaction);
		expect(await fixture.admission.admitOccurrence(fixture.transaction, { ...input })).toBe(result);
	});

	it("keeps each schedule coordinate in its retry identity", async function _ScheduleCoordinates()
	{
		const fixture = _fixture();
		const inputs = [_schedule(), _schedule({ siloId: "silo-2" }), _schedule({ routineId: "routine-2" }), _schedule({ routineRevision: 3 }), _schedule({ slotEpochMs: 1_790_352_060_000 })];
		const receipts = [];
		for (const input of inputs)
			receipts.push(await fixture.admission.admitSchedule(fixture.transaction, input));
		expect(new Set(receipts.map(receipt => receipt.taskId)).size).toBe(inputs.length);
	});

	it("separates tenant and firing keys even when identifiers contain delimiters", async function _OccurrenceCoordinates()
	{
		const fixture = _fixture();
		const inputs = [_occurrence({ siloId: "a:b", firingId: "c" }), _occurrence({ siloId: "a", firingId: "b:c" }), _occurrence({ firingId: "firing-2" })];
		const receipts = [];
		for (const input of inputs)
			receipts.push(await fixture.admission.admitOccurrence(fixture.transaction, input));
		expect(new Set(receipts.map(receipt => receipt.taskId)).size).toBe(inputs.length);
	});

	it.each([
		{ siloId: "" }, { routineId: " routine-1" }, { routineRevision: 0 }, { routineRevision: Number.MAX_SAFE_INTEGER + 1 },
		{ slotEpochMs: Number.NaN }, { slotEpochMs: Number.POSITIVE_INFINITY }, { slotEpochMs: 0.5 }, { slotEpochMs: 8_640_000_000_000_001 },
	])("rejects malformed schedule coordinates before calling the engine: %j", async function _InvalidSchedule(overrides)
	{
		const fixture = _fixture();
		await expect(fixture.admission.admitSchedule(fixture.transaction, _schedule(overrides))).rejects.toThrow("Routine schedule task input is invalid");
		expect(fixture.spawn).not.toHaveBeenCalled();
	});

	it.each([{ firingId: " " }, { siloId: "silo-1 " }, { routineId: "" }, { routineRevision: 1.5 }])("rejects malformed occurrence coordinates before calling the engine: %j", async function _InvalidOccurrence(overrides)
	{
		const fixture = _fixture();
		await expect(fixture.admission.admitOccurrence(fixture.transaction, _occurrence(overrides))).rejects.toThrow("Routine occurrence task input is invalid");
		expect(fixture.spawn).not.toHaveBeenCalled();
	});

	it("rejects extra input fields instead of silently dropping persisted evidence", async function _UnexpectedFields()
	{
		const fixture = _fixture();
		const schedule = { ..._schedule(), unexpected: "not admitted" };
		const occurrence = { ..._occurrence(), unexpected: "not admitted" };
		await expect(fixture.admission.admitSchedule(fixture.transaction, schedule)).rejects.toThrow("Routine schedule task input is invalid");
		await expect(fixture.admission.admitOccurrence(fixture.transaction, occurrence)).rejects.toThrow("Routine occurrence task input is invalid");
		expect(fixture.spawn).not.toHaveBeenCalled();
	});

	it("propagates admission failure without retrying outside the caller transaction", async function _Failure()
	{
		const fixture = _fixture();
		const failure = new Error("workflow admission unavailable");
		fixture.spawn.mockRejectedValueOnce(failure);
		await expect(fixture.admission.admitSchedule(fixture.transaction, _schedule())).rejects.toBe(failure);
		expect(fixture.spawn).toHaveBeenCalledTimes(1);
	});
});
