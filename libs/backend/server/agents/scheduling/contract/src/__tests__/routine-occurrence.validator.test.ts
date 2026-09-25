import { describe, expect, it } from "vitest";

import { RoutineComputerActivationStatus } from "../routine-occurrence.types";
import { ___ParseRoutineComputerActivationReceipt, ___ParseRoutineComputerActivationResult, ___ParseRoutineOccurrencePreparationReceipt, ___ParseRoutineRunAdmissionReceipt } from "../routine-occurrence.validator";

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
		{ status: RoutineComputerActivationStatus.Active, receipt: { receiptId: "activation-1", computerReference: "computer-1", digest: _DIGEST } },
		{ status: RoutineComputerActivationStatus.Pending, notBeforeEpochMs: 1_000, expiresAtEpochMs: 4_000 },
		{ status: RoutineComputerActivationStatus.Refused },
	])("preserves a strict $status activation result", function _ActivationResult(result)
	{
		expect(___ParseRoutineComputerActivationResult(result)).toEqual(result);
	});

	it.each([
		["unknown status", { status: "warming" }],
		["active without receipt", { status: RoutineComputerActivationStatus.Active }],
		["malformed active receipt", { status: RoutineComputerActivationStatus.Active, receipt: { receiptId: "activation-1", computerReference: "computer-1", digest: "wrong" } }],
		["pending with fractional time", { status: RoutineComputerActivationStatus.Pending, notBeforeEpochMs: 1.5, expiresAtEpochMs: 4_000 }],
		["pending after expiry", { status: RoutineComputerActivationStatus.Pending, notBeforeEpochMs: 4_001, expiresAtEpochMs: 4_000 }],
		["refused with evidence", { status: RoutineComputerActivationStatus.Refused, receipt: { receiptId: "activation-1", computerReference: "computer-1", digest: _DIGEST } }],
		["unknown field", { status: RoutineComputerActivationStatus.Pending, notBeforeEpochMs: 1_000, expiresAtEpochMs: 4_000, extra: true }],
	] as const)("rejects an activation result with %s", function _InvalidActivationResult(_name, result)
	{
		expect(function _Parse() { ___ParseRoutineComputerActivationResult(result); }).toThrow("routine computer activation result is invalid");
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
