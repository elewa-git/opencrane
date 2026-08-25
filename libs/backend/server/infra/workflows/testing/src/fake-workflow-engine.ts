import { WorkflowTaskCancelledError, WorkflowTaskNotDeclaredError, WorkflowTaskNotRegisteredError, WorkflowTaskRetryBackoffKinds, WorkflowTaskStates } from "@opencrane/backend/server/infra/workflows/contract";
import type { IWorkflowCheckpointOperation, IWorkflowCheckpointStep, IWorkflowTaskDeclaration, IWorkflowTaskEventReceipt, IWorkflowEngine, IWorkflowTransaction, IWorkflowTaskContext, IWorkflowTaskDefinition, IWorkflowTaskEvent, IWorkflowTaskReceipt, IWorkflowTaskSpawn, IWorkflowWorkerRuntime, IWorkflowWorkers, IWorkflowWorkerStart } from "@opencrane/backend/server/infra/workflows/contract";

import type { FakeWorkflowTaskSnapshot } from "./fake-workflow-engine.types";

/** Return the persisted default policy when a declaration does not request retries. */
function _RetryPolicy(policy: IWorkflowTaskDeclaration["retryPolicy"]): NonNullable<IWorkflowTaskDeclaration["retryPolicy"]>
{
	return policy ?? { maximumAttempts: 1, backoff: { kind: WorkflowTaskRetryBackoffKinds.Fixed, initialDelaySeconds: 0 } };
}

/** Compare retry policies by their actual values instead of source object shape. */
function _SameRetryPolicy(left: NonNullable<IWorkflowTaskDeclaration["retryPolicy"]>, right: NonNullable<IWorkflowTaskDeclaration["retryPolicy"]>): boolean
{
	return left.maximumAttempts === right.maximumAttempts && left.backoff.kind === right.backoff.kind && left.backoff.initialDelaySeconds === right.backoff.initialDelaySeconds && left.backoff.multiplier === right.backoff.multiplier && left.backoff.maximumDelaySeconds === right.backoff.maximumDelaySeconds;
}

/** In-memory execution adapter for deterministic contract and domain tests without an engine. */
export class __FakeWorkflowEngine implements IWorkflowEngine, IWorkflowWorkerRuntime
{
	/** Registered task handlers keyed by their stable task name. */
	private readonly definitions = new Map<string, IWorkflowTaskDefinition<unknown, unknown>>();
	/** Stores task declarations that permit admission without a local worker handler. */
	private readonly declarations = new Map<string, IWorkflowTaskDeclaration>();
	/** Admitted task records keyed by their generated task identifier. */
	private readonly tasks = new Map<string, _FakeTaskRecord>();
	/** Reuses one receipt for each task-name and idempotency-key pair. */
	private readonly receiptsByKey = new Map<string, IWorkflowTaskReceipt>();
	/** Stores events that arrived before their receiving task waited for them. */
	private readonly eventsByTask = new Map<string, IWorkflowTaskEvent<unknown>[]>();
	/** Resolves a task's current event wait when an event is emitted. */
	private readonly eventWaiters = new Map<string, _EventWaiter>();
	/** Allocates deterministic task identifiers in admission order. */
	private nextTaskNumber = 1;
	/** Allocates deterministic worker identifiers in start order. */
	private nextWorkerNumber = 1;

	/** Register one handler, rejecting a different handler that tries to reuse its name. */
	register<TInput, TResult>(definition: IWorkflowTaskDefinition<TInput, TResult>): void
	{
		this.declare(definition);
		const existing = this.definitions.get(definition.taskName);
		if (existing !== undefined && existing.run !== definition.run)
			throw new Error(`A different workflow task is already registered for ${definition.taskName}`);
		this.definitions.set(definition.taskName, definition as IWorkflowTaskDefinition<unknown, unknown>);
	}

	/** Declare one reviewed task without adding a handler that fake workers can execute. */
	declare(declaration: IWorkflowTaskDeclaration): void
	{
		const existing = this.declarations.get(declaration.taskName);
		if (existing !== undefined && !_SameRetryPolicy(_RetryPolicy(existing.retryPolicy), _RetryPolicy(declaration.retryPolicy)))
			throw new Error(`A different workflow declaration already exists for ${declaration.taskName}`);
		this.declarations.set(declaration.taskName, { taskName: declaration.taskName, retryPolicy: declaration.retryPolicy });
	}

	/** Admit a pending task and retain the caller's transaction only at this port boundary. */
	async spawn<TInput>(_transaction: IWorkflowTransaction, task: IWorkflowTaskSpawn<TInput>): Promise<IWorkflowTaskReceipt>
	{
		if (!this.declarations.has(task.taskName))
			throw new WorkflowTaskNotDeclaredError(task.taskName);
		const definition = this.definitions.get(task.taskName);

		const receiptKey = _ReceiptKey(task.taskName, task.idempotencyKey);
		const existing = this.receiptsByKey.get(receiptKey);
		if (existing !== undefined)
			return existing;

		const receipt = { taskId: `fake-task-${this.nextTaskNumber}`, taskName: task.taskName, idempotencyKey: task.idempotencyKey };
		this.nextTaskNumber += 1;
		this.receiptsByKey.set(receiptKey, receipt);
		this.tasks.set(receipt.taskId, { receipt, definition, input: task.input, attempt: 1, state: WorkflowTaskStates.Pending, result: undefined, error: undefined });
		return receipt;
	}

	/** Select the positive handler attempt supplied to a pending task in a retry-focused test. */
	setTaskAttempt(task: IWorkflowTaskReceipt, attempt: number): void
	{
		if (!Number.isSafeInteger(attempt) || attempt < 1)
			throw new Error("Fake workflow task attempt must be a positive integer");
		const record = this._TaskFor(task);
		if (record.state !== WorkflowTaskStates.Pending)
			throw new Error(`Cannot change attempt for ${record.state} task ${task.taskId}`);
		record.attempt = attempt;
	}

	/** Deliver an event now or queue it until its task asks for the matching event name. */
	async emitEvent<TPayload>(task: IWorkflowTaskReceipt, event: IWorkflowTaskEvent<TPayload>): Promise<IWorkflowTaskEventReceipt>
	{
		const record = this._TaskFor(task);
		this._AssertNotCancelled(record);
		const waiter = this.eventWaiters.get(task.taskId);
		if (waiter !== undefined && waiter.eventName === event.eventName)
		{
			this.eventWaiters.delete(task.taskId);
			waiter.resolve(event);
			return { task, eventName: event.eventName };
		}

		const queuedEvents = this.eventsByTask.get(task.taskId) ?? [];
		queuedEvents.push(event);
		this.eventsByTask.set(task.taskId, queuedEvents);
		return { task, eventName: event.eventName };
	}

	/** Cancel an incomplete task and reject any event wait that would otherwise keep it alive. */
	async cancel(task: IWorkflowTaskReceipt): Promise<IWorkflowTaskReceipt>
	{
		const record = this._TaskFor(task);
		if (record.state === WorkflowTaskStates.Completed || record.state === WorkflowTaskStates.Failed)
			return record.receipt;
		record.state = WorkflowTaskStates.Cancelled;
		const waiter = this.eventWaiters.get(task.taskId);
		if (waiter !== undefined)
		{
			this.eventWaiters.delete(task.taskId);
			waiter.reject(new WorkflowTaskCancelledError(task.taskId));
		}
		return record.receipt;
	}

	/** Run every pending task in deterministic admission order and report the started worker group. */
	async startWorkers(worker: IWorkflowWorkerStart): Promise<IWorkflowWorkers>
	{
		const workers = new _FakeWorkflowWorkers(`fake-worker-${this.nextWorkerNumber}`, worker.workerName, this);
		this.nextWorkerNumber += 1;
		await workers.drain();
		return workers;
	}

	/** Release no resources because the deterministic fake owns no external process state. */
	async close(): Promise<void> {}

	/** Dispatch each pending task in admission order for a fake worker lifecycle. */
	async _DrainPendingTasks(): Promise<void>
	{
		for (const record of this.tasks.values())
		{
			if (record.state === WorkflowTaskStates.Pending && record.definition !== undefined)
				await this._RunTask(record);
		}
	}

	/** Return one immutable projection of the current in-memory task state. */
	taskSnapshot(task: IWorkflowTaskReceipt): FakeWorkflowTaskSnapshot
	{
		const record = this._TaskFor(task);
		return { receipt: record.receipt, state: record.state, result: record.result, error: record.error };
	}

	/** Run one pending child task before returning its result to the parent task. */
	async _AwaitChild<TResult>(task: IWorkflowTaskReceipt): Promise<TResult>
	{
		const record = this._TaskFor(task);
		if (record.state === WorkflowTaskStates.Pending)
			await this._RunTask(record);
		if (record.state === WorkflowTaskStates.Cancelled)
			throw new WorkflowTaskCancelledError(task.taskId);
		if (record.state === WorkflowTaskStates.Failed)
			throw record.error;
		return record.result as TResult;
	}

	/** Run one task handler and retain its final state for assertions. */
	async _RunTask(record: _FakeTaskRecord): Promise<void>
	{
		this._AssertNotCancelled(record);
		record.state = WorkflowTaskStates.Running;
		try
		{
		if (record.definition === undefined)
			throw new WorkflowTaskNotRegisteredError(record.receipt.taskName);
		record.result = await record.definition.run(this._ContextFor(record), record.input);
			this._AssertNotCancelled(record);
			record.state = WorkflowTaskStates.Completed;
		}
		catch (error: unknown)
		{
			if (!this._IsCancelled(record))
			{
				record.error = error;
				record.state = WorkflowTaskStates.Failed;
			}
		}
	}

	/** Build the engine-neutral task context that delegates every operation to this fake. */
	_ContextFor(record: _FakeTaskRecord): IWorkflowTaskContext
	{
		const self = this;
		return {
			task: record.receipt,
			attempt: record.attempt,
			async checkpoint<TResult>(_step: IWorkflowCheckpointStep, operation: IWorkflowCheckpointOperation<TResult>): Promise<TResult>
			{
				self._AssertNotCancelled(record);
				return operation();
			},
			async waitForEvent<TPayload>(eventName: string): Promise<IWorkflowTaskEvent<TPayload>>
			{
				self._AssertNotCancelled(record);
				const queuedEvents = self.eventsByTask.get(record.receipt.taskId) ?? [];
				const eventIndex = queuedEvents.findIndex(event => event.eventName === eventName);
				if (eventIndex >= 0)
				{
					const event = queuedEvents.splice(eventIndex, 1)[0];
					self.eventsByTask.set(record.receipt.taskId, queuedEvents);
					return event as IWorkflowTaskEvent<TPayload>;
				}
				return new Promise<IWorkflowTaskEvent<TPayload>>(function _wait(resolve, reject)
				{
					self.eventWaiters.set(record.receipt.taskId, { eventName, resolve: _ResolveEvent, reject });

					/** Resolve this generic wait with the engine-neutral stored event. */
					function _ResolveEvent(event: IWorkflowTaskEvent<unknown>): void
					{
						resolve(event as IWorkflowTaskEvent<TPayload>);
					}
				});
			},
			async spawnChild<TInput>(task: IWorkflowTaskSpawn<TInput>): Promise<IWorkflowTaskReceipt>
			{
				return self.spawn({ client: undefined }, task);
			},
			async awaitChild<TResult>(task: IWorkflowTaskReceipt): Promise<TResult>
			{
				return self._AwaitChild<TResult>(task);
			},
			async sleepUntil(instant: Date): Promise<void>
			{
				self._AssertNotCancelled(record);
				if (instant.getTime() > Date.now())
					throw new Error("The fake workflow engine cannot advance time");
			},
		};
	}

	/** Return the tracked record after confirming the supplied receipt refers to that exact task. */
	_TaskFor(task: IWorkflowTaskReceipt): _FakeTaskRecord
	{
		const record = this.tasks.get(task.taskId);
		if (record === undefined || record.receipt.taskName !== task.taskName || record.receipt.idempotencyKey !== task.idempotencyKey)
			throw new Error(`Unknown workflow task ${task.taskId}`);
		return record;
	}

	/** Throw before a cancelled task can perform another fake engine operation. */
	_AssertNotCancelled(record: _FakeTaskRecord): void
	{
		if (record.state === WorkflowTaskStates.Cancelled)
			throw new WorkflowTaskCancelledError(record.receipt.taskId);
	}

	/** Read cancellation through one helper because an async handler may change this record. */
	_IsCancelled(record: _FakeTaskRecord): boolean
	{
		return record.state === WorkflowTaskStates.Cancelled;
	}
}

/** Worker lifecycle that drains this fake's deterministic pending-task queue. */
class _FakeWorkflowWorkers implements IWorkflowWorkers
{
	/** Engine-free identifier for this worker group. */
	readonly workerId: string;
	/** Process-local name supplied when this worker group started. */
	readonly workerName: string;
	/** Fake execution whose pending tasks this worker group drains. */
	private readonly execution: __FakeWorkflowEngine;
	/** Records that this worker group was stopped after its final drain. */
	private stopped = false;

	/** Bind a lifecycle handle to one fake execution instance. */
	constructor(workerId: string, workerName: string, execution: __FakeWorkflowEngine)
	{
		this.workerId = workerId;
		this.workerName = workerName;
		this.execution = execution;
	}

	/** Dispatch every pending fake task in admission order unless this worker group has stopped. */
	async drain(): Promise<void>
	{
		if (this.stopped)
			return;
		await this.execution._DrainPendingTasks();
	}

	/** Mark this worker group stopped so later drain calls do not dispatch more fake work. */
	async stop(): Promise<void>
	{
		this.stopped = true;
	}
}

/** Mutable record the fake keeps behind its immutable public task projection. */
interface _FakeTaskRecord
{
	/** Stable task reference. */
	receipt: IWorkflowTaskReceipt;
	/** Registered handler selected by the task receipt. */
	definition: IWorkflowTaskDefinition<unknown, unknown> | undefined;
	/** Input captured at task admission. */
	input: unknown;
	/** Positive attempt number supplied to the next handler run. */
	attempt: number;
	/** Current engine-like lifecycle state. */
	state: WorkflowTaskStates;
	/** Handler result after a completed task. */
	result: unknown;
	/** Handler failure after a failed task. */
	error: unknown;
}

/** Pending waiter for one event name on one task. */
interface _EventWaiter
{
	/** Event name that resolves this waiter. */
	eventName: string;
	/** Resolve the wait with a matching event. */
	resolve: (event: IWorkflowTaskEvent<unknown>) => void;
	/** Reject the wait when cancellation interrupts the task. */
	reject: (error: unknown) => void;
}

/** Build the deterministic map key for a task-name and domain idempotency key pair. */
function _ReceiptKey(taskName: string, idempotencyKey: string): string
{
	return `${taskName}\u0000${idempotencyKey}`;
}
