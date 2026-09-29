import { describe, expect, it } from "vitest";

import { AgentRunStates, AgentRunTerminalReasons, RoutineFiringDisposition } from "@opencrane/models/agents";

import { ___ParseRoutineRunProgressObservation } from "../routine-run-progress.validator";
import type { RoutineRunProgressObservation } from "../routine-run-progress.types";

const _BASE: RoutineRunProgressObservation = { siloId: "silo-1", routineId: "routine-1", routineRevision: 1, firingId: "firing-1", runId: "run-1", attempt: 1, inputSnapshotDigest: `sha256:${"1".repeat(64)}`, sourceState: AgentRunStates.Running, sourceFinishedAt: null, sourceTerminalReason: null, sourceCancellationCommandId: null, sourceCancellationCommandDigest: null, disposition: RoutineFiringDisposition.Waiting, resultReference: null, resultDigest: null };
const _EVIDENCE = { resultReference: "history-1", resultDigest: `sha256:${"2".repeat(64)}` };

describe("routine run progress observation", function _Suite()
{
	it("preserves a valid protocol wait and a verified completed answer", function _Valid()
	{
		expect(___ParseRoutineRunProgressObservation(_BASE)).toEqual(_BASE);
		const completed = { ..._BASE, sourceState: AgentRunStates.Completed, sourceFinishedAt: "2026-09-26T12:00:00.000Z", sourceTerminalReason: AgentRunTerminalReasons.Success, disposition: RoutineFiringDisposition.Completed, ..._EVIDENCE };
		expect(___ParseRoutineRunProgressObservation(completed)).toEqual(completed);
	});

	it.each([
		{ siloId: " " }, { attempt: 0 }, { routineRevision: 1.5 }, { inputSnapshotDigest: "sha256:bad" },
		{ unexpected: true }, { sourceFinishedAt: "bad" }, { sourceFinishedAt: "2026-09-26T12:00:00Z" },
		{ resultReference: "orphan" }, { sourceCancellationCommandId: "orphan" },
		{ sourceState: AgentRunStates.Cancelling, disposition: RoutineFiringDisposition.Cancelled },
		{ sourceState: AgentRunStates.Failed, disposition: RoutineFiringDisposition.Failed },
		{ sourceState: AgentRunStates.WaitingForInput },
		{ sourceState: AgentRunStates.RecoveryRequired, disposition: RoutineFiringDisposition.Uncertain },
		{ sourceState: AgentRunStates.Completed, disposition: RoutineFiringDisposition.Completed, ..._EVIDENCE },
	])("rejects malformed or unproved source facts %j", function _Reject(patch)
	{
		expect(function _Parse() { ___ParseRoutineRunProgressObservation({ ..._BASE, ...patch }); }).toThrow("observation is invalid");
	});

	it("requires final cancellation, Stop evidence and the user-cancelled reason", function _Cancellation()
	{
		const cancelled = { ..._BASE, sourceState: AgentRunStates.Cancelled, sourceFinishedAt: "2026-09-26T12:00:00.000Z", sourceTerminalReason: AgentRunTerminalReasons.UserCancelled, sourceCancellationCommandId: "stop-1", sourceCancellationCommandDigest: _EVIDENCE.resultDigest, disposition: RoutineFiringDisposition.Cancelled, ..._EVIDENCE };
		expect(___ParseRoutineRunProgressObservation(cancelled)).toEqual(cancelled);
		expect(function _Parse() { ___ParseRoutineRunProgressObservation({ ...cancelled, sourceTerminalReason: AgentRunTerminalReasons.Success }); }).toThrow();
	});
});
