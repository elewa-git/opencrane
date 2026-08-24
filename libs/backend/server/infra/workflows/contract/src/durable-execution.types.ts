/**
 * Opaque transaction context that binds task admission to the caller's product write.
 *
 * The caller supplies the same database transaction that will commit or roll back its product
 * change. Contract consumers must treat {@link DurableExecutionTransaction.client} as opaque;
 * an engine adapter validates and casts it privately when it invokes its transaction-bound API.
 */
export interface DurableExecutionTransaction
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
 * string through a `DurableTaskStates` projection.
 */
export enum DurableTaskStates
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

/** One registered task handler and its stable task name. */
export interface DurableTaskDefinition<TInput, TResult>
{
	/** Stable engine-neutral name used by callers to select this task handler. */
	readonly taskName: string;
	/** Reviewed attempt limit and delay policy applied whenever the handler asks for a retry. */
	readonly retryPolicy?: DurableTaskRetryPolicy;
	/** Runs the task with replay-safe context operations supplied by the execution engine. */
	readonly run: DurableTaskRunner<TInput, TResult>;
}

/** Delay shapes available to a task that asks the engine to retry it. */
export enum DurableTaskRetryBackoffKinds
{
	/** Every later attempt waits the same number of seconds. */
	Fixed = "fixed",
	/** Each later attempt multiplies the previous delay up to the configured ceiling. */
	Exponential = "exponential",
}

/** Reviewed retry limit stored with an admitted task rather than chosen by a worker failure. */
export interface DurableTaskRetryPolicy
{
	/** Total number of handler attempts, including the first one. */
	readonly maximumAttempts: number;
	/** Delay applied before a later attempt becomes available to a worker. */
	readonly backoff: {
		readonly kind: DurableTaskRetryBackoffKinds;
		readonly initialDelaySeconds: number;
		readonly multiplier?: number;
		readonly maximumDelaySeconds?: number;
	};
}

/** Function a registered durable task runs when an engine dispatches it. */
export interface DurableTaskRunner<TInput, TResult>
{
	/** Run one task with its engine-supplied context and admitted input. */
	(context: DurableTaskContext, input: TInput): Promise<TResult>;
}

/** One request to admit a task within the caller's database transaction. */
export interface DurableTaskSpawn<TInput>
{
	/** Registered task name to execute. */
	readonly taskName: string;
	/** Domain-derived stable key that makes repeated admission return the same task receipt. */
	readonly idempotencyKey: string;
	/** Immutable input handed to the registered task handler. */
	readonly input: TInput;
}

/** Stable reference to an admitted task. */
export interface DurableTaskReceipt
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
 * kit and engine adapter. Domains do not select queues, so a task cannot pass one policy and run
 * on another queue.
 */
export interface DurableTaskQueueAuthority
{
	/** Return the reviewed queue for a registered task, or reject an unreviewed task name. */
	queueForTask(taskName: string): string;
}

/** One application event delivered to a task. */
export interface DurableTaskEvent<TPayload>
{
	/** Event name the receiving task waits for. */
	readonly eventName: string;
	/** Application-owned event data; this contract does not prescribe its schema. */
	readonly payload: TPayload;
}

/** Receipt for an event accepted for a specific task. */
export interface DurableEventReceipt
{
	/** Task that will receive the event while it waits for the matching name. */
	readonly task: DurableTaskReceipt;
	/** Accepted event name. */
	readonly eventName: string;
}

/** Identifies a replay-safe checkpoint inside one task handler. */
export interface DurableCheckpointStep
{
	/** Task-local stable name for this checkpoint. */
	readonly stepName: string;
}

/** Function a task runs once for one named replay-safe checkpoint. */
export interface DurableCheckpointOperation<TResult>
{
	/** Perform the checkpoint's effect and return its recorded result. */
	(): Promise<TResult>;
}

/** Starts the engine worker lifecycle without exposing engine workers to domain code. */
export interface DurableWorkerStart
{
	/** Process-local name used to distinguish this worker group in diagnostics. */
	readonly workerName: string;
}

/** Process-local worker lifecycle returned by {@link DurableWorkerRuntime.startWorkers}. */
export interface DurableWorkers
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
 * Product domains receive {@link DurableExecution}, which deliberately omits this lifecycle
 * control. The server composition root holds this separate port and drains it during shutdown.
 */
export interface DurableWorkerRuntime
{
	/** Start one process-local worker group that dispatches registered tasks. */
	startWorkers(worker: DurableWorkerStart): Promise<DurableWorkers>;
	/** Drain every worker group and release engine-owned process resources. */
	close(): Promise<void>;
}

/** Context that an engine supplies while it runs a registered task handler. */
export interface DurableTaskContext
{
	/** Receipt for the task currently being executed. */
	readonly task: DurableTaskReceipt;
	/** Run one named operation so an engine can resume it without repeating a completed effect. */
	checkpoint<TResult>(step: DurableCheckpointStep, operation: DurableCheckpointOperation<TResult>): Promise<TResult>;
	/** Wait until an event with this name is delivered to the current task. */
	waitForEvent<TPayload>(eventName: string): Promise<DurableTaskEvent<TPayload>>;
	/** Admit a child task that belongs to the current task's durable execution. */
	spawnChild<TInput>(task: DurableTaskSpawn<TInput>): Promise<DurableTaskReceipt>;
	/** Wait for a child task receipt and return the result produced by its handler. */
	awaitChild<TResult>(task: DurableTaskReceipt): Promise<TResult>;
	/** Suspend this task until the supplied instant rather than holding a process timer. */
	sleepUntil(instant: Date): Promise<void>;
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
export interface DurableExecution
{
	/** Register a task handler before any caller admits tasks with its name. */
	register<TInput, TResult>(definition: DurableTaskDefinition<TInput, TResult>): void;
	/** Admit a task through the caller's transaction, so task admission shares its commit decision. */
	spawn<TInput>(transaction: DurableExecutionTransaction, task: DurableTaskSpawn<TInput>): Promise<DurableTaskReceipt>;
	/** Deliver an application event to one admitted task. */
	emitEvent<TPayload>(task: DurableTaskReceipt, event: DurableTaskEvent<TPayload>): Promise<DurableEventReceipt>;
	/** Cancel an incomplete task and prevent later handler work from being admitted. */
	cancel(task: DurableTaskReceipt): Promise<DurableTaskReceipt>;
}

/** Base error for a durable execution contract violation. */
export class DurableExecutionError extends Error
{
	/** Creates a contract error with a message fit for operator diagnostics. */
	constructor(message: string)
	{
		super(message);
		this.name = "DurableExecutionError";
	}
}

/** Error raised when a caller references a task name that no registered handler owns. */
export class DurableTaskNotRegisteredError extends DurableExecutionError
{
	/** Creates an error that reports the missing registered task name. */
	constructor(taskName: string)
	{
		super(`No durable task is registered for ${taskName}`);
		this.name = "DurableTaskNotRegisteredError";
	}
}

/** Error raised when a cancelled task tries to continue durable work. */
export class DurableTaskCancelledError extends DurableExecutionError
{
	/** Creates an error that reports the cancelled task identifier. */
	constructor(taskId: string)
	{
		super(`Durable task ${taskId} was cancelled`);
		this.name = "DurableTaskCancelledError";
	}
}

/**
 * Tells an execution engine what to do after a task handler deliberately fails.
 *
 * Task handlers select one of these closed outcomes through a {@link DurableTaskFailureError}.
 * `Retryable` permits another attempt, while `Terminal` records the failure without another
 * attempt. A task handler communicates that choice by throwing the matching
 * {@link DurableTaskFailureError} subclass.
 */
export enum DurableTaskFailureKinds
{
	/** The effect may be retried because the failure is expected to be transient. */
	Retryable = "retryable",
	/** The task must stop because retrying cannot change the outcome. */
	Terminal = "terminal",
}

/** Base error for a task handler that deliberately selects one closed engine failure outcome. */
export abstract class DurableTaskFailureError extends DurableExecutionError
{
	/** Closed outcome category that an engine must apply to this failure. */
	readonly kind: DurableTaskFailureKinds;

	/** Create a failure with its selected engine outcome category. */
	protected constructor(kind: DurableTaskFailureKinds, message: string)
	{
		super(message);
		this.kind = kind;
	}
}

/** Error that tells the engine a later retry may complete the same task. */
export class DurableTaskRetryableError extends DurableTaskFailureError
{
	/** Create a retryable failure without leaking engine-specific retry details. */
	constructor(message: string)
	{
		super(DurableTaskFailureKinds.Retryable, message);
		this.name = "DurableTaskRetryableError";
	}
}

/** Error that tells the engine to record failure without another task attempt. */
export class DurableTaskTerminalError extends DurableTaskFailureError
{
	/** Create a terminal failure without leaking engine-specific completion details. */
	constructor(message: string)
	{
		super(DurableTaskFailureKinds.Terminal, message);
		this.name = "DurableTaskTerminalError";
	}
}
