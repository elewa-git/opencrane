/**
 * Controls whether a saved routine accepts automatic and manual firing commands.
 *
 * The backend stores these string values with a routine and rejects unknown values. A status grants
 * no permission by itself: the backend must still check the requester and the current agent revision.
 */
export enum RoutineStatus
{
	/** Automatic and manual firing commands may proceed to current permission checks. */
	Active = "active",
	/** Automatic firing is disabled, while an authorized manual command may still run immediately. */
	Paused = "paused",
	/** No new firing may start. This status cannot be reversed. */
	Retired = "retired",
}

/**
 * Records why a routine firing was considered.
 *
 * The backend stores this value with each firing identity. Automatic firings use a schedule slot;
 * manual firings use a retained request ID and never change the automatic cursor.
 */
export enum RoutineFiringTrigger
{
	/** A database-clock sweep selected a schedule slot. */
	Automatic = "automatic",
	/** An authorized person deliberately requested an immediate firing. */
	Manual = "manual",
}

/**
 * Describes the saved outcome or execution stage of a routine firing.
 *
 * These strings are stored by the scheduling backend, so changing one requires a data migration.
 * The model defines the closed set but does not own transitions; the backend owns every atomic state
 * change and rejects unknown values.
 */
export enum RoutineFiringDisposition
{
	/** The firing claim was saved, but no run has been accepted yet. Not terminal. */
	Preparing = "preparing",
	/** Run admission succeeded and execution is active. Not terminal. */
	Running = "running",
	/** Execution paused for input or approval and may resume. Not terminal. */
	Waiting = "waiting",
	/** Execution finished successfully. Terminal. */
	Completed = "completed",
	/** Execution stopped with a known failure. Terminal. */
	Failed = "failed",
	/** An authorized cancellation stopped the firing. Terminal. */
	Cancelled = "cancelled",
	/** An automatic slot was consumed because another firing was unfinished. Terminal. */
	SkippedOverlap = "skipped_overlap",
	/** Current permission or lifecycle checks denied the firing before a run started. Terminal. */
	Refused = "refused",
	/** Execution may have caused an external effect. Not terminal: automatic overlap stays blocked until review. */
	Uncertain = "uncertain",
}

/** Dispositions that make a later automatic slot skip instead of overlapping work. */
export type RoutineUnfinishedFiringDisposition = RoutineFiringDisposition.Preparing | RoutineFiringDisposition.Running | RoutineFiringDisposition.Waiting | RoutineFiringDisposition.Uncertain;
