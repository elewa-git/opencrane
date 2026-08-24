/**
 * Records what Absurd accepted when it admitted a task through the caller's transaction.
 *
 * The workflow engine maps this vendor receipt to its engine-neutral task receipt before domain
 * code sees it. The extra run and attempt details stay inside this adapter boundary.
 */
export interface IWorkflowTaskAdmissionReceipt
{
	/** Stable engine task identity. */
	readonly taskId: string;
	/** Engine run identity for the new task or the existing task that matched this idempotency key. */
	readonly runId: string;
	/** Positive attempt number for the new task or its idempotency match. */
	readonly attempt: number;
	/** States whether this call created a task; false returns the existing task's latest run and attempt. */
	readonly created: boolean;
}

/**
 * Describes the task that this adapter submits through `absurd.spawn_task`.
 *
 * The engine supplies a domain-derived idempotency key. This adapter scopes that key by task name
 * before sending it to Absurd, so different task definitions can share a queue safely.
 */
export interface IWorkflowTaskAdmissionRequest
{
	/** Registered Absurd task name. */
	readonly taskName: string;
	/** Deterministic duplicate-prevention key from the caller. */
	readonly idempotencyKey: string;
	/** JSON-compatible input delivered to the registered task. */
	readonly input: unknown;
}

/**
 * Admits a task through the caller's open database transaction.
 *
 * Called by: {@link AbsurdWorkflowEngine} through {@link WorkflowTaskAdmission}. The caller keeps
 * the transaction open; implementations must not open, commit, or roll back a separate one.
 */
export interface IWorkflowTaskAdmission
{
	/** Submits one validated task and returns the vendor receipt that confirms admission. */
	admit(transactionClient: unknown, request: IWorkflowTaskAdmissionRequest): Promise<IWorkflowTaskAdmissionReceipt>;
}
