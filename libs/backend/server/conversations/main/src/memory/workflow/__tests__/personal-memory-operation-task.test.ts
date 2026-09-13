import { describe, expect, it } from "vitest";

import { _CreatePersonalMemoryOperationTask } from "../personal-memory-operation-task";

const _INPUT = { siloId: "memory-silo", operationId: "928b379d-d679-42db-bd46-c938bb15f3d1" };

describe("personal memory workflow admission input", function _Suite()
{
	it("reuses one operation key without storing caller-selected task identity", function _Replay()
	{
		const first = _CreatePersonalMemoryOperationTask(_INPUT);
		const retry = _CreatePersonalMemoryOperationTask({ ..._INPUT });
		expect(retry).toEqual(first);
		expect(first.idempotencyKey).toBe(_INPUT.operationId);
		expect(Object.keys(first.input).sort()).toEqual(["operationId", "siloId"]);
	});

	it.each(["text", "source", "credential", "authority", "providerDatasetId", "taskId"])("rejects an extra %s field instead of saving it in Absurd", function _ExtraField(field)
	{
		expect(function _Create() { return _CreatePersonalMemoryOperationTask({ ..._INPUT, [field]: "must not enter task input" }); }).toThrow();
	});

	it.each(["", " ", " memory-silo", "memory-silo ", "x".repeat(129)])("rejects a noncanonical silo identifier %j", function _InvalidSilo(siloId)
	{
		expect(function _Create() { return _CreatePersonalMemoryOperationTask({ ..._INPUT, siloId }); }).toThrow();
	});

	it("keeps its validated input independent of a later caller mutation", function _ImmutableInput()
	{
		const input = { ..._INPUT };
		const task = _CreatePersonalMemoryOperationTask(input);
		input.siloId = "another-silo";
		expect(task.input.siloId).toBe(_INPUT.siloId);
	});
});
