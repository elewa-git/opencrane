import type { IWorkflowTaskReceipt, WorkflowTaskStates } from "@opencrane/backend/server/infra/workflows/contract";

/** Deterministic task projection exposed by the engine-free contract test double. */
export interface FakeWorkflowTaskSnapshot
{
	/** Stable task reference. */
	readonly receipt: IWorkflowTaskReceipt;
	/** Current state produced by the test double. */
	readonly state: WorkflowTaskStates;
	/** Handler result after the task completes, when it produced one. */
	readonly result: unknown;
	/** Handler failure after the task fails, when it threw one. */
	readonly error: unknown;
}
