import { WorkflowTaskRetryBackoffKinds, type IWorkflowTaskDeclaration } from "@opencrane/backend/server/infra/workflows/contract";

/** Stable task name for one bounded automatic schedule wake. */
export const ROUTINE_SCHEDULE_TASK_NAME = "agents.routines.schedule/v1";

/** Stable task name for one immutable occurrence preparation and run admission. */
export const ROUTINE_OCCURRENCE_TASK_NAME = "agents.routines.occurrence/v1";

/** Reviewed retry policy for a schedule wake; each successor is a fresh task. */
export const RoutineScheduleTaskDeclaration: IWorkflowTaskDeclaration = {
	taskName: ROUTINE_SCHEDULE_TASK_NAME,
	retryPolicy: { maximumAttempts: 3, backoff: { kind: WorkflowTaskRetryBackoffKinds.Fixed, initialDelaySeconds: 1 } },
};

/** Reviewed retry policy for idempotent asynchronous occurrence preparation. */
export const RoutineOccurrenceTaskDeclaration: IWorkflowTaskDeclaration = {
	taskName: ROUTINE_OCCURRENCE_TASK_NAME,
	retryPolicy: { maximumAttempts: 3, backoff: { kind: WorkflowTaskRetryBackoffKinds.Exponential, initialDelaySeconds: 1, multiplier: 2, maximumDelaySeconds: 30 } },
};
