import { describe, expect, it } from "vitest";

import { ___ParseRoutineComputerActivationReceipt, ___ParseRoutineOccurrencePreparationReceipt, ___ParseRoutineRunAdmissionReceipt } from "../routine-occurrence.validator";

/** Valid SHA-256 digest used by every receipt fixture. */
const _DIGEST = `sha256:${"a".repeat(64)}`;

describe("routine occurrence receipt validation", function _Suite()
{
	it("preserves complete preparation and activation receipts", function _StageReceipts()
	{
		const preparation = { receiptId: "preparation-1", historyReference: "history-1", digest: _DIGEST };
		const activation = { receiptId: "activation-1", computerReference: "computer-1", digest: _DIGEST };

		expect(___ParseRoutineOccurrencePreparationReceipt(preparation)).toEqual(preparation);
		expect(___ParseRoutineComputerActivationReceipt(activation)).toEqual(activation);
	});

	it("preserves the complete run-admission checkpoint receipt", function _RunAdmission()
	{
		const receipt = { runId: "run-1", inputSnapshotDigest: _DIGEST, runTask: { taskId: "task-1", taskName: "agents.runs.execute/v1", idempotencyKey: "run-1" } };

		expect(___ParseRoutineRunAdmissionReceipt(receipt)).toEqual(receipt);
	});

	it.each([
		["blank run", { runId: " " }],
		["malformed digest", { inputSnapshotDigest: "sha256:not-a-digest" }],
		["missing task key", { runTask: { taskId: "task-1", taskName: "agents.runs.execute/v1" } }],
		["unknown task field", { runTask: { taskId: "task-1", taskName: "agents.runs.execute/v1", idempotencyKey: "run-1", extra: true } }],
		["unknown receipt field", { extra: true }],
	])("rejects a run-admission receipt with %s", function _Rejects(_name, change)
	{
		const receipt = { runId: "run-1", inputSnapshotDigest: _DIGEST, runTask: { taskId: "task-1", taskName: "agents.runs.execute/v1", idempotencyKey: "run-1" }, ...change };

		expect(function _Parse() { ___ParseRoutineRunAdmissionReceipt(receipt); }).toThrow("routine run admission receipt is invalid");
	});

	it.each([
		["preparation", function _Parse(value: unknown) { return ___ParseRoutineOccurrencePreparationReceipt(value); }, { receiptId: "preparation-1", historyReference: "history-1", digest: _DIGEST }],
		["activation", function _Parse(value: unknown) { return ___ParseRoutineComputerActivationReceipt(value); }, { receiptId: "activation-1", computerReference: "computer-1", digest: _DIGEST }],
	])("rejects unknown fields on a %s receipt", function _RejectsUnknown(_name, parse, receipt)
	{
		expect(function _Parse() { parse({ ...receipt, extra: true }); }).toThrow(/receipt is invalid/u);
	});
});
