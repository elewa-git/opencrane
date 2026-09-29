import type { RoutineSchedule } from "./routine-schedule.types";
import { RoutineFiringDisposition, RoutineFiringTrigger, RoutineStatus, type RoutineUnfinishedFiringDisposition } from "./routine.types";

/** Records which trusted actor caused a routine effect while the requester remains entitled. */
export interface RoutineFiringAuditActor
{
	/** Identifies whether the actor is a human command or the durable scheduler. */
	readonly actorKind: "user" | "system";
	/** Identifies the saved requester or the stable scheduler actor profile. */
	readonly actorId: string;
}

/**
 * Supplies a database-owned snapshot for pure firing selection.
 *
 * The backend must read these values consistently and re-evaluate after any concurrent edit or
 * firing wins. Browser input must never supply this snapshot.
 */
export interface RoutineFiringSelection
{
	/** Separates firing identities that belong to different silos. */
	readonly siloId: string;
	/** Identifies the routine independently of its current revision. */
	readonly routineId: string;
	/** Contains the current saved lifecycle status. */
	readonly status: RoutineStatus;
	/** Distinguishes schedule selection from a deliberate immediate command. */
	readonly trigger: RoutineFiringTrigger;
	/** Contains the schedule from the current saved routine revision. */
	readonly schedule: RoutineSchedule;
	/** Comes from the database clock, never the browser or worker clock. */
	readonly nowEpochMs: number;
	/** Excludes slots at or before creation, resume or revision replacement. */
	readonly automaticEnabledAfterEpochMs: number;
	/** Contains the latest automatic slot saved as claimed or skipped, or null before the first one. */
	readonly lastAutomaticOccurrenceEpochMs: number | null;
	/** Contains the unfinished firing that blocks automatic overlap, or null when none exists. */
	readonly unfinishedFiringDisposition: RoutineUnfinishedFiringDisposition | null;
	/** Retains an idempotency identity for a manual command; automatic selection must omit it. */
	readonly manualRequestId?: string;
}

/** Reports that no automatic firing exists for the current lifecycle and clock snapshot. */
export interface RoutineNoFiringPlan
{
	/** Uses null because there is no firing row or lifecycle disposition to save. */
	readonly disposition: null;
	/** Is always automatic because every allowed manual command creates a saved outcome. */
	readonly trigger: RoutineFiringTrigger.Automatic;
	/** Contains the next slot when the routine is active, and is absent while disabled. */
	readonly nextAutomaticOccurrenceEpochMs?: number;
}

/** Proposes saving a firing claim before asking run admission to accept it. */
export interface RoutinePreparingFiringPlan
{
	/** Prevents callers from reporting execution before run admission succeeds. */
	readonly disposition: RoutineFiringDisposition.Preparing;
	/** Preserves whether a schedule or deliberate command selected the firing. */
	readonly trigger: RoutineFiringTrigger;
	/** Identifies retries of this schedule slot or manual command. */
	readonly firingKey: string;
	/** Contains the automatic slot and is absent for manual work. */
	readonly scheduledForEpochMs?: number;
	/** Contains the next automatic slot and is absent for manual work. */
	readonly nextAutomaticOccurrenceEpochMs?: number;
	/** Proposes the cursor value to save with an automatic claim and is absent for manual work. */
	readonly advanceAutomaticCursorToEpochMs?: number;
}

/** Proposes saving an automatic overlap skip and consuming that schedule slot. */
export interface RoutineSkippedOverlapFiringPlan
{
	/** Records why this automatic slot did not start a run. */
	readonly disposition: RoutineFiringDisposition.SkippedOverlap;
	/** Confirms that overlap policy never applies to manual work. */
	readonly trigger: RoutineFiringTrigger.Automatic;
	/** Identifies retries that observed the same skipped slot. */
	readonly firingKey: string;
	/** Preserves the UTC slot selected by the schedule. */
	readonly scheduledForEpochMs: number;
	/** Contains the first automatic slot after the observed database clock. */
	readonly nextAutomaticOccurrenceEpochMs: number;
	/** Proposes consuming the skipped slot in the same transaction as the firing record. */
	readonly advanceAutomaticCursorToEpochMs: number;
}

/** Proposes saving a refused manual command after the routine was retired. */
export interface RoutineRefusedFiringPlan
{
	/** Records a lifecycle refusal without starting a run. */
	readonly disposition: RoutineFiringDisposition.Refused;
	/** Is manual because disabled automatic sweeps create no firing row. */
	readonly trigger: RoutineFiringTrigger.Manual;
	/** Identifies retries of the refused manual command. */
	readonly firingKey: string;
}

/**
 * Contains the pure firing decision that the backend may save atomically.
 *
 * A plan grants no permission and changes no cursor by itself. The backend must repeat current
 * lifecycle, permission and agent-revision checks inside its transaction.
 */
export type RoutineFiringPlan = RoutineNoFiringPlan | RoutinePreparingFiringPlan | RoutineSkippedOverlapFiringPlan | RoutineRefusedFiringPlan;

/** Keeps lifecycle dispatch exhaustive while automatic and manual strategy code stays separate. */
export type RoutineFiringStatusHandler = (selection: RoutineFiringSelection) => RoutineFiringPlan;
