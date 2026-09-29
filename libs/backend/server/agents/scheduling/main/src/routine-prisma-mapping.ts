import { RoutineFiringDisposition, RoutineFiringTrigger, RoutineStatus } from "@opencrane/models/agents";

/** Generated Prisma status values kept at the persistence mapping boundary. */
const _DATABASE_ROUTINE_STATUS = { Active: "Active", Paused: "Paused", Retired: "Retired" } as const;

/** Generated Prisma trigger values kept at the persistence mapping boundary. */
const _DATABASE_FIRING_TRIGGER = { Automatic: "Automatic", Manual: "Manual" } as const;

/** Generated Prisma disposition values kept at the persistence mapping boundary. */
const _DATABASE_FIRING_DISPOSITION = { Preparing: "Preparing", Running: "Running", Waiting: "Waiting", Completed: "Completed", Failed: "Failed", Cancelled: "Cancelled", SkippedOverlap: "SkippedOverlap", Refused: "Refused", Uncertain: "Uncertain" } as const;

/** String union generated for the routine lifecycle column. */
type DatabaseRoutineStatus = (typeof _DATABASE_ROUTINE_STATUS)[keyof typeof _DATABASE_ROUTINE_STATUS];
/** String union generated for the routine firing trigger column. */
type DatabaseFiringTrigger = (typeof _DATABASE_FIRING_TRIGGER)[keyof typeof _DATABASE_FIRING_TRIGGER];
/** String union generated for the routine firing disposition column. */
type DatabaseFiringDisposition = (typeof _DATABASE_FIRING_DISPOSITION)[keyof typeof _DATABASE_FIRING_DISPOSITION];

/** Maps model lifecycle values to their Prisma persistence vocabulary. */
export const _PRISMA_ROUTINE_STATUS: Readonly<Record<RoutineStatus, DatabaseRoutineStatus>> = {
	[RoutineStatus.Active]: _DATABASE_ROUTINE_STATUS.Active,
	[RoutineStatus.Paused]: _DATABASE_ROUTINE_STATUS.Paused,
	[RoutineStatus.Retired]: _DATABASE_ROUTINE_STATUS.Retired,
};

/** Maps Prisma lifecycle values back to the public model vocabulary. */
export const _MODEL_ROUTINE_STATUS: Readonly<Record<DatabaseRoutineStatus, RoutineStatus>> = {
	[_DATABASE_ROUTINE_STATUS.Active]: RoutineStatus.Active,
	[_DATABASE_ROUTINE_STATUS.Paused]: RoutineStatus.Paused,
	[_DATABASE_ROUTINE_STATUS.Retired]: RoutineStatus.Retired,
};

/** Maps firing triggers to the database vocabulary. */
export const _PRISMA_FIRING_TRIGGER: Readonly<Record<RoutineFiringTrigger, DatabaseFiringTrigger>> = {
	[RoutineFiringTrigger.Automatic]: _DATABASE_FIRING_TRIGGER.Automatic,
	[RoutineFiringTrigger.Manual]: _DATABASE_FIRING_TRIGGER.Manual,
};

/** Maps database firing triggers to the model vocabulary. */
export const _MODEL_FIRING_TRIGGER: Readonly<Record<DatabaseFiringTrigger, RoutineFiringTrigger>> = {
	[_DATABASE_FIRING_TRIGGER.Automatic]: RoutineFiringTrigger.Automatic,
	[_DATABASE_FIRING_TRIGGER.Manual]: RoutineFiringTrigger.Manual,
};

/** Maps firing dispositions to the database vocabulary. */
export const _PRISMA_FIRING_DISPOSITION: Readonly<Record<RoutineFiringDisposition, DatabaseFiringDisposition>> = {
	[RoutineFiringDisposition.Preparing]: _DATABASE_FIRING_DISPOSITION.Preparing,
	[RoutineFiringDisposition.Running]: _DATABASE_FIRING_DISPOSITION.Running,
	[RoutineFiringDisposition.Waiting]: _DATABASE_FIRING_DISPOSITION.Waiting,
	[RoutineFiringDisposition.Completed]: _DATABASE_FIRING_DISPOSITION.Completed,
	[RoutineFiringDisposition.Failed]: _DATABASE_FIRING_DISPOSITION.Failed,
	[RoutineFiringDisposition.Cancelled]: _DATABASE_FIRING_DISPOSITION.Cancelled,
	[RoutineFiringDisposition.SkippedOverlap]: _DATABASE_FIRING_DISPOSITION.SkippedOverlap,
	[RoutineFiringDisposition.Refused]: _DATABASE_FIRING_DISPOSITION.Refused,
	[RoutineFiringDisposition.Uncertain]: _DATABASE_FIRING_DISPOSITION.Uncertain,
};

/** Maps database firing dispositions to the public model vocabulary. */
export const _MODEL_FIRING_DISPOSITION: Readonly<Record<DatabaseFiringDisposition, RoutineFiringDisposition>> = {
	[_DATABASE_FIRING_DISPOSITION.Preparing]: RoutineFiringDisposition.Preparing,
	[_DATABASE_FIRING_DISPOSITION.Running]: RoutineFiringDisposition.Running,
	[_DATABASE_FIRING_DISPOSITION.Waiting]: RoutineFiringDisposition.Waiting,
	[_DATABASE_FIRING_DISPOSITION.Completed]: RoutineFiringDisposition.Completed,
	[_DATABASE_FIRING_DISPOSITION.Failed]: RoutineFiringDisposition.Failed,
	[_DATABASE_FIRING_DISPOSITION.Cancelled]: RoutineFiringDisposition.Cancelled,
	[_DATABASE_FIRING_DISPOSITION.SkippedOverlap]: RoutineFiringDisposition.SkippedOverlap,
	[_DATABASE_FIRING_DISPOSITION.Refused]: RoutineFiringDisposition.Refused,
	[_DATABASE_FIRING_DISPOSITION.Uncertain]: RoutineFiringDisposition.Uncertain,
};
