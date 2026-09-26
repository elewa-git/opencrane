import { z } from "zod";

import { AgentRunStates, AgentRunTerminalReasons, RoutineFiringDisposition, type AgentRunState } from "@opencrane/models/agents";

import type { RoutineRunProgressObservation } from "./routine-run-progress.types";

/** Checks producer observations at the scheduling boundary without dropping unknown fields. */
const _Reference = z.string().refine(function _Nonblank(value) { return value.trim().length > 0; });

/** Preserves the digest representation shared by stored snapshots and conversation receipts. */
const _Digest = z.custom<`sha256:${string}`>(function _IsDigest(value): value is `sha256:${string}`
{
	return typeof value === "string" && /^sha256:[0-9a-f]{64}$/u.test(value);
});

/** Accepts the exact timestamp representation emitted by the run facts reader. */
const _Timestamp = z.string().datetime().refine(function _CanonicalTimestamp(value)
{
	const date = new Date(value);
	return Number.isFinite(date.getTime()) && date.toISOString() === value;
});

/**
 * Limits observations to outcomes that the current conversation producers can prove. Protocol
 * waits retain a Running run state; unsupported source states cannot manufacture a terminal result.
 */
const _TargetsBySource: Readonly<Record<AgentRunState, readonly RoutineFiringDisposition[]>> = {
	[AgentRunStates.Accepted]: [],
	[AgentRunStates.Queued]: [],
	[AgentRunStates.Assigned]: [],
	[AgentRunStates.Running]: [RoutineFiringDisposition.Running, RoutineFiringDisposition.Waiting],
	[AgentRunStates.WaitingForInput]: [],
	[AgentRunStates.RecoveryRequired]: [RoutineFiringDisposition.Uncertain],
	[AgentRunStates.Cancelling]: [],
	[AgentRunStates.Completed]: [RoutineFiringDisposition.Completed],
	[AgentRunStates.Cancelled]: [RoutineFiringDisposition.Cancelled],
	[AgentRunStates.Failed]: [],
};

/** Validates the complete content-free record together with its required evidence pair. */
const _ObservationSchema: z.ZodType<RoutineRunProgressObservation> = z.object({
	siloId: _Reference,
	routineId: _Reference,
	routineRevision: z.number().int().safe().positive(),
	firingId: _Reference,
	runId: _Reference,
	attempt: z.number().int().safe().positive(),
	inputSnapshotDigest: _Digest,
	sourceState: z.nativeEnum(AgentRunStates),
	sourceFinishedAt: _Timestamp.nullable(),
	sourceTerminalReason: z.nativeEnum(AgentRunTerminalReasons).nullable(),
	sourceCancellationCommandId: _Reference.nullable(),
	sourceCancellationCommandDigest: _Digest.nullable(),
	disposition: z.nativeEnum(RoutineFiringDisposition),
	resultReference: _Reference.nullable(),
	resultDigest: _Digest.nullable(),
}).strict().refine(_HasConsistentEvidence);

/** Rejects source/target combinations that no current producer can legitimately report; a producer must add its evidence before acknowledgement. */
function _HasConsistentEvidence(value: RoutineRunProgressObservation): boolean
{
	if (!_TargetsBySource[value.sourceState].includes(value.disposition))
		return false;
	if ((value.resultReference === null) !== (value.resultDigest === null) || (value.sourceCancellationCommandId === null) !== (value.sourceCancellationCommandDigest === null))
		return false;
	if (value.sourceState === AgentRunStates.Completed)
		return value.sourceFinishedAt !== null && value.sourceTerminalReason === AgentRunTerminalReasons.Success && value.resultReference !== null;
	if (value.sourceState === AgentRunStates.Cancelled)
		return value.sourceFinishedAt !== null && value.sourceTerminalReason === AgentRunTerminalReasons.UserCancelled && value.sourceCancellationCommandId !== null && value.resultReference !== null;
	if (value.sourceFinishedAt !== null || value.sourceTerminalReason !== null)
		return false;
	if (value.sourceState === AgentRunStates.RecoveryRequired)
		return value.resultReference !== null;
	return value.resultReference === null;
}

/**
 * Restores a producer observation without changing any source coordinate or evidence field.
 * @throws When fields are missing, unknown, malformed, or inconsistent with the saved source state.
 */
export function ___ParseRoutineRunProgressObservation(value: unknown): RoutineRunProgressObservation
{
	const parsed = _ObservationSchema.safeParse(value);
	if (!parsed.success)
		throw new Error("routine run progress observation is invalid");
	return parsed.data;
}
