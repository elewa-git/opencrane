import type { AgentRunTaskInput } from "@opencrane/backend/agents/execution/runs/workflows/contract";
import type { IWorkflowTaskReceipt, IWorkflowTransaction } from "@opencrane/backend/server/infra/workflows/contract";

/**
 * Explains why a repository refused to return a task record for workflow admission.
 *
 * {@link __AdmitAgentRunWorkflowTask} turns every member into an error before it starts the remote
 * task or binds a receipt. These strings are diagnostics within this package, not a saved AgentRun
 * state or an API response. A repository adds a reason only when it must stop that admission.
 *
 * @see __AdmitAgentRunWorkflowTask for the rejection boundary.
 */
export enum AgentRunWorkflowAdmissionRejectionReasons
{
	/** The requested run belongs to another silo. */
	ForeignSilo = "foreign_silo",
	/** The requested attempt is no longer the run's current attempt. */
	StaleAttempt = "stale_attempt",
	/** A matching attempt already has different immutable task facts. */
	ConflictingTask = "conflicting_task",
}

/**
 * Identifies the AgentRun attempt that workflow admission may save as a remote task.
 *
 * It reuses {@link AgentRunTaskInput}, so admission and the future task handler use the same silo,
 * run, and attempt coordinates. Admission rejects a repository record whose coordinates differ.
 *
 * @see AgentRunTaskInput for the shared task input.
 */
export type AgentRunWorkflowAdmissionCommand = AgentRunTaskInput;

/**
 * Carries the task facts a repository created or found before the workflow engine is called.
 *
 * Admission checks that the returned coordinates still match its command, then gives `taskKey` to
 * the engine as its idempotency key. A missing or conflicting fact stops admission before a remote
 * task is saved.
 */
export interface AgentRunWorkflowTaskRecord extends AgentRunTaskInput
{
	/** Identifies repeated requests to admit this run attempt as the same remote task. */
	readonly taskKey: string;
}

/**
 * Gives workflow admission either a task record or a reason it must stop.
 *
 * A repository must return exactly one outcome. Admission treats a missing record without a reason,
 * or both values together, as an invalid decision and does not start a remote task.
 */
export interface AgentRunWorkflowTaskResolution
{
	/** Allows admission to start the remote task after the repository rechecked the request. */
	readonly record?: AgentRunWorkflowTaskRecord;
	/** Stops admission before the workflow engine can save a remote task. */
	readonly rejectionReason?: AgentRunWorkflowAdmissionRejectionReasons;
}

/**
 * Provides the task-record operations that workflow admission uses inside the caller's transaction.
 *
 * The repository must recheck the run and attempt before returning a record, because admission
 * starts the remote task only after that decision. A conflicting receipt binding makes admission
 * throw so the caller can roll back its product write and task admission together.
 */
export interface AgentRunWorkflowTaskRepository
{
	/**
	 * Creates or finds one task record after checking the request still names the same silo and current attempt.
	 *
	 * Called by: {@link __AdmitAgentRunWorkflowTask}.
	 * @returns A task record to admit or a reason that stops admission before the workflow engine is called.
	 */
	createOrFind(command: AgentRunWorkflowAdmissionCommand): Promise<AgentRunWorkflowTaskResolution>;
	/**
	 * Binds a workflow receipt to the task record after the engine saves the remote task.
	 *
	 * Called by: {@link __AdmitAgentRunWorkflowTask}. `"bound"` records this receipt for the first
	 * time. `"idempotent"` is allowed only when this exact task ID, task name, and idempotency key
	 * are already bound. `"conflict"` makes admission throw.
	 */
	bindTask(record: AgentRunWorkflowTaskRecord, receipt: IWorkflowTaskReceipt): Promise<"bound" | "idempotent" | "conflict">;
}

/**
 * Carries the transaction that makes the task record and workflow-engine admission one database decision.
 *
 * Admission passes `workflowTransaction` unchanged to the engine and uses `tasks` around that call.
 * An adapter must scope both to the caller's database transaction so a thrown admission error can
 * roll back both changes.
 */
export interface AgentRunWorkflowAdmissionTransaction
{
	/** Gives the workflow engine the opaque transaction supplied by the caller. */
	readonly workflowTransaction: IWorkflowTransaction;
	/** Provides task-record operations built against that same caller-owned transaction. */
	readonly tasks: AgentRunWorkflowTaskRepository;
}

/**
 * Returns the task record and receipt after workflow admission accepted the request.
 *
 * The receipt has passed the task-name and idempotency-key checks and was offered to the repository
 * for binding. The caller may keep using its transaction; this value does not commit it.
 */
export interface AgentRunWorkflowAdmission
{
	/** Identifies the run attempt that the repository allowed the engine to admit. */
	readonly task: AgentRunWorkflowTaskRecord;
	/** Identifies the remote task whose receipt passed the admission checks. */
	readonly receipt: IWorkflowTaskReceipt;
}

/**
 * Reports a repository decision or receipt that makes the current admission unsafe to continue.
 *
 * Admission throws this error before returning, leaving the transaction owner to roll back its
 * product write and task admission together.
 */
export class AgentRunWorkflowAdmissionError extends Error
{
	/** Creates an error that tells the transaction owner why admission stopped. */
	constructor(message: string)
	{
		super(message);
		this.name = "AgentRunWorkflowAdmissionError";
	}
}
