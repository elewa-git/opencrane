/**
 * Opaque transaction context that binds task admission to the caller's product write.
 *
 * The caller supplies the same database transaction that will commit or roll back its product
 * change. Contract consumers must treat {@link IWorkflowTransaction.client} as opaque;
 * an engine adapter validates and casts it privately when it invokes its transaction-bound API.
 */
export interface IWorkflowTransaction
{
	/** Opaque caller-owned transaction client; this boundary never defines or reuses its type. */
	readonly client: unknown;
}

/**
 * Describes the lifecycle state that a diagnostic projection reports for an admitted task.
 *
 * This enum is not a product state machine: domain code uses the execution contract, while test
 * doubles and engine diagnostics expose these values. `Completed`, `Failed`, and `Cancelled` are
 * terminal; a reader that treats `Pending` or `Running` as terminal can stop workers while work is
 * still owed. TypeScript declares this as a closed set, so an adapter must not report a different
 * string through a `WorkflowTaskStates` projection.
 */
export enum WorkflowTaskStates
{
	/** The task was admitted but no worker has started its handler. */
	Pending = "pending",
	/** A worker is currently executing the task handler. */
	Running = "running",
	/** The task handler returned a result. */
	Completed = "completed",
	/** The task handler threw an error. */
	Failed = "failed",
	/** A caller cancelled the task before it completed. */
	Cancelled = "cancelled",
}

/**
 * Describes a task that this process may admit even when another process runs its handler.
 *
 * Application composition declares remote tasks before it writes product state and admits the
 * matching workflow task in the same database transaction. The task name and retry policy must
 * match the handler registration in the worker process.
 */
export interface IWorkflowTaskDeclaration
{
	/** Stable engine-neutral name used by callers to select this task handler. */
	readonly taskName: string;
	/** Reviewed attempt limit and delay policy applied whenever the handler asks for a retry. */
	readonly retryPolicy?: IWorkflowTaskRetryPolicy;
}

/** One locally registered task handler whose declaration also permits admission. */
export interface IWorkflowTaskDefinition<TInput, TResult> extends IWorkflowTaskDeclaration
{
	/** Runs the task with replay-safe context operations supplied by the execution engine. */
	readonly run: IWorkflowTaskRunner<TInput, TResult>;
}

/** Delay shapes available to a task that asks the engine to retry it. */
export enum WorkflowTaskRetryBackoffKinds
{
	/** Every later attempt waits the same number of seconds. */
	Fixed = "fixed",
	/** Each later attempt multiplies the previous delay up to the configured ceiling. */
	Exponential = "exponential",
}

/** Describes the delay applied before the engine runs a later task attempt. */
export interface IWorkflowTaskRetryBackoff
{
	/** Selects how the delay changes after each failed attempt. */
	readonly kind: WorkflowTaskRetryBackoffKinds;
	/** Sets the first retry delay in whole seconds. */
	readonly initialDelaySeconds: number;
	/** Multiplies the previous delay when exponential backoff is selected. */
	readonly multiplier?: number;
	/** Caps an increasing retry delay in whole seconds. */
	readonly maximumDelaySeconds?: number;
}

/** Sets the attempt limit and delay policy stored with an admitted workflow task. */
export interface IWorkflowTaskRetryPolicy
{
	/** Total number of handler attempts, including the first one. */
	readonly maximumAttempts: number;
	/** Delay applied before a later attempt becomes available to a worker. */
	readonly backoff: IWorkflowTaskRetryBackoff;
}

/** Function a registered workflow task runs when an engine dispatches it. */
export interface IWorkflowTaskRunner<TInput, TResult>
{
	/** Run one task with its engine-supplied context and admitted input. */
	(context: IWorkflowTaskContext, input: TInput): Promise<TResult>;
}

/** One request to admit a task within the caller's database transaction. */
export interface IWorkflowTaskSpawn<TInput>
{
	/** Registered task name to execute. */
	readonly taskName: string;
	/** Domain-derived stable key that makes repeated admission return the same task receipt. */
	readonly idempotencyKey: string;
	/** Immutable input handed to the registered task handler. */
	readonly input: TInput;
}

/** Stable reference to an admitted task. */
export interface IWorkflowTaskReceipt
{
	/** Engine-owned stable task identifier. */
	readonly taskId: string;
	/** Registered task name that accepted the task. */
	readonly taskName: string;
	/** Domain key that identifies repeated admission attempts for this task. */
	readonly idempotencyKey: string;
}

/**
 * Resolves the reviewed engine queue for one registered task name.
 *
 * Application composition creates one immutable authority and gives that same object to the task
 * guard and engine adapter. Domains do not select queues, so a task cannot pass one policy and run
 * on another queue.
 */
export interface IWorkflowTaskQueueAuthority
{
	/** Return the reviewed queue for a registered task, or reject an unreviewed task name. */
	queueForTask(taskName: string): string;
}

/** One application event delivered to a task. */
export interface IWorkflowTaskEvent<TPayload>
{
	/** Event name the receiving task waits for. */
	readonly eventName: string;
	/** Application-owned event data; this contract does not prescribe its schema. */
	readonly payload: TPayload;
}

/** Receipt for an event accepted for a specific task. */
export interface IWorkflowTaskEventReceipt
{
	/** Task that will receive the event while it waits for the matching name. */
	readonly task: IWorkflowTaskReceipt;
	/** Accepted event name. */
	readonly eventName: string;
}

/** Identifies a replay-safe checkpoint inside one task handler. */
export interface IWorkflowCheckpointStep
{
	/** Task-local stable name for this checkpoint. */
	readonly stepName: string;
}

/** Function a task runs once for one named replay-safe checkpoint. */
export interface IWorkflowCheckpointOperation<TResult>
{
	/** Perform the checkpoint's effect and return its recorded result. */
	(): Promise<TResult>;
}

/** Starts the engine worker lifecycle without exposing engine workers to domain code. */
export interface IWorkflowWorkerStart
{
	/** Process-local name used to distinguish this worker group in diagnostics. */
	readonly workerName: string;
}

/** Process-local worker lifecycle returned by {@link IWorkflowWorkerRuntime.startWorkers}. */
export interface IWorkflowWorkers
{
	/** Engine-owned identifier for the running worker group. */
	readonly workerId: string;
	/** Process-local worker name supplied by the caller. */
	readonly workerName: string;
	/** Finish dispatching work already accepted by this worker group before it stops. */
	drain(): Promise<void>;
	/** Stop this worker group from accepting further dispatch work. */
	stop(): Promise<void>;
}

/**
 * Starts engine workers from server composition after all reviewed tasks are registered.
 *
 * Product domains receive {@link IWorkflowEngine}, which deliberately omits this lifecycle
 * control. The server composition root holds this separate port and drains it during shutdown.
 */
export interface IWorkflowWorkerRuntime
{
	/** Start one process-local worker group that dispatches registered tasks. */
	startWorkers(worker: IWorkflowWorkerStart): Promise<IWorkflowWorkers>;
	/** Drain every worker group and release engine-owned process resources. */
	close(): Promise<void>;
}

/** Context that an engine supplies while it runs a registered task handler. */
export interface IWorkflowTaskContext
{
	/** Receipt for the task currently being executed. */
	readonly task: IWorkflowTaskReceipt;
	/** Positive engine attempt number for the current handler run. */
	readonly attempt: number;
	/** Run one named operation so an engine can resume it without repeating a completed effect. */
	checkpoint<TResult>(step: IWorkflowCheckpointStep, operation: IWorkflowCheckpointOperation<TResult>): Promise<TResult>;
	/** Wait until an event with this name is delivered to the current task. */
	waitForEvent<TPayload>(eventName: string): Promise<IWorkflowTaskEvent<TPayload>>;
	/** Admit a child task that belongs to the current task's workflow engine. */
	spawnChild<TInput>(task: IWorkflowTaskSpawn<TInput>): Promise<IWorkflowTaskReceipt>;
	/** Wait for a child task receipt and return the result produced by its handler. */
	awaitChild<TResult>(task: IWorkflowTaskReceipt): Promise<TResult>;
	/** Suspend this task at a named replay point until the supplied instant rather than holding a process timer. */
	sleepUntil(instant: Date, stepName?: string): Promise<void>;
}

/**
 * Admits and controls asynchronous control-plane tasks without exposing a workflow engine to a domain.
 *
 * A caller supplies its product transaction to {@link spawn}, so the product write and task
 * admission share one commit decision. Domains use this port instead of an engine SDK; this keeps
 * engine identifiers out of domain contracts and prevents an after-commit spawn from losing work if
 * the process stops between the write and admission.
 *
 * ADR 0013 records the transaction-bound adapter decision.
 */
export interface IWorkflowEngine
{
	/**
	 * Declare a reviewed task that this process may admit without registering a local handler.
	 *
	 * Called by: server composition for tasks whose handler runs in a controller process.
	 * @param declaration - Stable task name and retry behavior shared with the remote worker.
	 * @throws WorkflowError when the name, queue policy, or retry behavior is invalid or conflicts.
	 */
	declare(declaration: IWorkflowTaskDeclaration): void;
	/** Register a task handler before any caller admits tasks with its name. */
	register<TInput, TResult>(definition: IWorkflowTaskDefinition<TInput, TResult>): void;
	/** Admit a task through the caller's transaction, so task admission shares its commit decision. */
	spawn<TInput>(transaction: IWorkflowTransaction, task: IWorkflowTaskSpawn<TInput>): Promise<IWorkflowTaskReceipt>;
	/** Deliver an application event to one admitted task. */
	emitEvent<TPayload>(task: IWorkflowTaskReceipt, event: IWorkflowTaskEvent<TPayload>): Promise<IWorkflowTaskEventReceipt>;
	/**
	 * Deliver an event through the database transaction that saved the product outcome.
	 *
	 * Use this when a worker outcome must wake a waiting task without leaving a crash window between
	 * the product write and event delivery. A replay uses the same task-scoped event name, and the
	 * engine's immutable event store keeps the first committed payload.
	 * Called by: product repositories that already own a transaction, including artifact preprocessing.
	 *
	 * @param transaction - Caller-owned database transaction that will commit or roll back the outcome.
	 * @param task - Admitted task that owns the private event name.
	 * @param event - Event name and small application payload delivered to that task.
	 * @returns Receipt for the accepted task event.
	 */
	emitEventInTransaction<TPayload>(transaction: IWorkflowTransaction, task: IWorkflowTaskReceipt, event: IWorkflowTaskEvent<TPayload>): Promise<IWorkflowTaskEventReceipt>;
	/** Cancel an incomplete task and prevent later handler work from being admitted. */
	cancel(task: IWorkflowTaskReceipt): Promise<IWorkflowTaskReceipt>;
}

/** Base error for a workflow engine contract violation. */
export class WorkflowError extends Error
{
	/** Creates a contract error with a message fit for operator diagnostics. */
	constructor(message: string)
	{
		super(message);
		this.name = "WorkflowError";
	}
}

/** Error raised when a caller references a task name that no registered handler owns. */
export class WorkflowTaskNotRegisteredError extends WorkflowError
{
	/** Creates an error that reports the missing registered task name. */
	constructor(taskName: string)
	{
		super(`No workflow task is registered for ${taskName}`);
		this.name = "WorkflowTaskNotRegisteredError";
	}
}

/** Error raised when a caller admits a task that no reviewed declaration permits. */
export class WorkflowTaskNotDeclaredError extends WorkflowError
{
	/**
	 * Report a task name that composition did not declare for admission.
	 *
	 * Called by: workflow adapters before they persist top-level or child work.
	 * @param taskName - Stable name the caller tried to admit.
	 */
	constructor(taskName: string)
	{
		super(`No workflow task is declared for ${taskName}`);
		this.name = "WorkflowTaskNotDeclaredError";
	}
}

/** Error raised when a cancelled task tries to continue workflow work. */
export class WorkflowTaskCancelledError extends WorkflowError
{
	/** Creates an error that reports the cancelled task identifier. */
	constructor(taskId: string)
	{
		super(`Workflow task ${taskId} was cancelled`);
		this.name = "WorkflowTaskCancelledError";
	}
}

/**
 * Tells an execution engine what to do after a task handler deliberately fails.
 *
 * Task handlers select one of these closed outcomes through a {@link WorkflowTaskFailureError}.
 * `Retryable` permits another attempt, while `Terminal` records the failure without another
 * attempt. A task handler communicates that choice by throwing the matching
 * {@link WorkflowTaskFailureError} subclass.
 */
export enum WorkflowTaskFailureKinds
{
	/** The effect may be retried because the failure is expected to be transient. */
	Retryable = "retryable",
	/** The task must stop because retrying cannot change the outcome. */
	Terminal = "terminal",
}

/** Base error for a task handler that deliberately selects one closed engine failure outcome. */
export abstract class WorkflowTaskFailureError extends WorkflowError
{
	/** Closed outcome category that an engine must apply to this failure. */
	readonly kind: WorkflowTaskFailureKinds;

	/** Create a failure with its selected engine outcome category. */
	protected constructor(kind: WorkflowTaskFailureKinds, message: string)
	{
		super(message);
		this.kind = kind;
	}
}

/** Error that tells the engine a later retry may complete the same task. */
export class WorkflowTaskRetryableError extends WorkflowTaskFailureError
{
	/** Create a retryable failure without leaking engine-specific retry details. */
	constructor(message: string)
	{
		super(WorkflowTaskFailureKinds.Retryable, message);
		this.name = "WorkflowTaskRetryableError";
	}
}

/** Error that tells the engine to record failure without another task attempt. */
export class WorkflowTaskTerminalError extends WorkflowTaskFailureError
{
	/** Create a terminal failure without leaking engine-specific completion details. */
	constructor(message: string)
	{
		super(WorkflowTaskFailureKinds.Terminal, message);
		this.name = "WorkflowTaskTerminalError";
	}
}
