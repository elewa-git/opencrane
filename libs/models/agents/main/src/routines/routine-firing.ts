import { ___DigestCanonicalJson } from "@opencrane/util";

import { AgentRunTriggers } from "../agent-run.types";

import { __LatestRoutineOccurrence, __NextRoutineOccurrence } from "./routine-calendar";
import type { RoutineFiringAuditActor, RoutineFiringPlan, RoutineFiringSelection, RoutineFiringStatusHandler } from "./routine-firing.types";
import { __RoutineFiringSelectionSchema } from "./routine-firing.validator";
import { RoutineFiringDisposition, RoutineFiringTrigger, RoutineStatus } from "./routine.types";

const _AUTOMATIC_ROUTINE_ACTOR_ID = "opencrane-server/routine-schedule/v1";

/** Maps a validated routine trigger to its audit actor without changing the entitled Principal. */
export function __RoutineFiringAuditActor(trigger: RoutineFiringTrigger | `${AgentRunTriggers.Scheduled}` | `${AgentRunTriggers.Manual}`, requesterPrincipalId: string): RoutineFiringAuditActor
{
	if (trigger === RoutineFiringTrigger.Automatic || trigger === AgentRunTriggers.Scheduled)
		return { actorKind: "system", actorId: _AUTOMATIC_ROUTINE_ACTOR_ID };
	return { actorKind: "user", actorId: requesterPrincipalId };
}

/** Dispatches every saved routine status through an explicit lifecycle owner. */
const _StatusHandlers: Readonly<Record<RoutineStatus, RoutineFiringStatusHandler>> = {
	[RoutineStatus.Active]: _planActive,
	[RoutineStatus.Paused]: _planPaused,
	[RoutineStatus.Retired]: _planRetired,
};

/**
 * Selects at most one schedule slot or deliberate command without starting work.
 *
 * Automatic recovery chooses the latest due slot. An unfinished firing consumes that slot as an
 * overlap skip. Manual selection ignores pause and overlap, but retirement produces a refused plan.
 * It never reads or changes the automatic cursor.
 *
 * The caller must lock the routine, repeat current permission and agent-revision checks, and save a
 * firing and any cursor advance atomically. After a competing write, it must read the saved outcome
 * and plan again from current state.
 *
 * @param value - Database-owned routine and firing snapshot with an explicit database clock.
 * @returns A frozen proposal. `Preparing` means a claim may be saved, not that a run is active.
 * @throws {Error} When the snapshot or calendar is invalid.
 */
export function __PlanRoutineFiring(value: RoutineFiringSelection): RoutineFiringPlan
{
	const selection = __RoutineFiringSelectionSchema.parse(value);
	return Object.freeze(_StatusHandlers[selection.status](selection));
}

/** Lets both trigger strategies proceed while the routine is active. */
function _planActive(selection: RoutineFiringSelection): RoutineFiringPlan
{
	if (selection.trigger === RoutineFiringTrigger.Manual)
		return _planManual(selection, RoutineFiringDisposition.Preparing);
	return _planAutomatic(selection);
}

/** Keeps automatic firing disabled while allowing a deliberate immediate command. */
function _planPaused(selection: RoutineFiringSelection): RoutineFiringPlan
{
	if (selection.trigger === RoutineFiringTrigger.Manual)
		return _planManual(selection, RoutineFiringDisposition.Preparing);
	return { disposition: null, trigger: RoutineFiringTrigger.Automatic };
}

/** Refuses a deliberate command after retirement and leaves automatic sweeps idle. */
function _planRetired(selection: RoutineFiringSelection): RoutineFiringPlan
{
	if (selection.trigger === RoutineFiringTrigger.Manual)
		return _planManual(selection, RoutineFiringDisposition.Refused);
	return { disposition: null, trigger: RoutineFiringTrigger.Automatic };
}

/** Keeps a manual command's identity separate without reading or changing the automatic cursor. */
function _planManual(selection: RoutineFiringSelection, disposition: RoutineFiringDisposition.Preparing | RoutineFiringDisposition.Refused): RoutineFiringPlan
{
	if (selection.manualRequestId === undefined)
		throw new Error("A manual firing requires its validated request ID");
	return {
		disposition,
		trigger: RoutineFiringTrigger.Manual,
		firingKey: ___DigestCanonicalJson({ namespace: "opencrane.routine.firing.v1", siloId: selection.siloId, routineId: selection.routineId, trigger: RoutineFiringTrigger.Manual, requestId: selection.manualRequestId }),
	};
}

/** Selects the latest unconsumed slot and proposes the next cursor wake. */
function _planAutomatic(selection: RoutineFiringSelection): RoutineFiringPlan
{
	const afterEpochMs = Math.max(selection.automaticEnabledAfterEpochMs, selection.lastAutomaticOccurrenceEpochMs ?? selection.automaticEnabledAfterEpochMs);
	const nextAutomaticOccurrenceEpochMs = __NextRoutineOccurrence(selection.schedule, Math.max(selection.nowEpochMs, selection.automaticEnabledAfterEpochMs));
	const occurrenceEpochMs = __LatestRoutineOccurrence(selection.schedule, afterEpochMs, selection.nowEpochMs);
	if (occurrenceEpochMs === null)
		return { disposition: null, trigger: RoutineFiringTrigger.Automatic, nextAutomaticOccurrenceEpochMs };
	const disposition = selection.unfinishedFiringDisposition === null
		? RoutineFiringDisposition.Preparing
		: RoutineFiringDisposition.SkippedOverlap;
	return {
		disposition,
		trigger: RoutineFiringTrigger.Automatic,
		firingKey: ___DigestCanonicalJson({ namespace: "opencrane.routine.firing.v1", siloId: selection.siloId, routineId: selection.routineId, trigger: RoutineFiringTrigger.Automatic, occurrenceEpochMs }),
		scheduledForEpochMs: occurrenceEpochMs,
		nextAutomaticOccurrenceEpochMs,
		advanceAutomaticCursorToEpochMs: occurrenceEpochMs,
	};
}
