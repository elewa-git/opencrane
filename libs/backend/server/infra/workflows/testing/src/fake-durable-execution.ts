import { DurableTaskCancelledError, DurableTaskNotRegisteredError, DurableTaskStates } from "@opencrane/backend/server/infra/workflows/contract";
import type { DurableCheckpointOperation, DurableCheckpointStep, DurableEventReceipt, DurableExecution, DurableExecutionTransaction, DurableTaskContext, DurableTaskDefinition, DurableTaskEvent, DurableTaskReceipt, DurableTaskSpawn, DurableWorkerRuntime, DurableWorkers, DurableWorkerStart } from "@opencrane/backend/server/infra/workflows/contract";

import type { FakeDurableTaskSnapshot } from "./fake-durable-execution.types";

/** In-memory execution adapter for deterministic contract and domain tests without an engine. */
export class __FakeDurableExecution implements DurableExecution, DurableWorkerRuntime
{
	/** Registered task handlers keyed by their stable task name. */
	private readonly definitions = new Map<string, DurableTaskDefinition<unknown, unknown>>();
	/** Admitted task records keyed by their generated task identifier. */
	private readonly tasks = new Map<string, _FakeTaskRecord>();
	/** Reuses one receipt for each task-name and idempotency-key pair. */
	private readonly receiptsByKey = new Map<string, DurableTaskReceipt>();
	/** Stores events that arrived before their receiving task waited for them. */
	private readonly eventsByTask = new Map<string, DurableTaskEvent<unknown>[]>();
	/** Resolves a task's current event wait when an event is emitted. */
	private readonly eventWaiters = new Map<string, _EventWaiter>();
	/** Allocates deterministic task identifiers in admission order. */
	private nextTaskNumber = 1;
	/** Allocates deterministic worker identifiers in start order. */
	private nextWorkerNumber = 1;

	/** Register one handler, rejecting a different handler that tries to reuse its name. */
	register<TInput, TResult>(definition: DurableTaskDefinition<TInput, TResult>): void
	{
		const existing = this.definitions.get(definition.taskName);
		if (existing !== undefined && existing.run !== definition.run)
			throw new Error(`A different durable task is already registered for ${definition.taskName}`);
		this.definitions.set(definition.taskName, definition as DurableTaskDefinition<unknown, unknown>);
	}

	/** Admit a pending task and retain the caller's transaction only at this port boundary. */
	async spawn<TInput>(_transaction: DurableExecutionTransaction, task: DurableTaskSpawn<TInput>): Promise<DurableTaskReceipt>
	{
		const definition = this.definitions.get(task.taskName);
		if (definition === undefined)
			throw new DurableTaskNotRegisteredError(task.taskName);

		const receiptKey = _ReceiptKey(task.taskName, task.idempotencyKey);
		const existing = this.receiptsByKey.get(receiptKey);
		if (existing !== undefined)
			return existing;

		const receipt = { taskId: `fake-task-${this.nextTaskNumber}`, taskName: task.taskName, idempotencyKey: task.idempotencyKey };
		this.nextTaskNumber += 1;
		this.receiptsByKey.set(receiptKey, receipt);
		this.tasks.set(receipt.taskId, { receipt, definition, input: task.input, attempt: 1, state: DurableTaskStates.Pending, result: undefined, error: undefined });
		return receipt;
	}

	/** Select the positive handler attempt supplied to a pending task in a retry-focused test. */
	setTaskAttempt(task: DurableTaskReceipt, attempt: number): void
	{
		if (!Number.isSafeInteger(attempt) || attempt < 1)
			throw new Error("Fake durable task attempt must be a positive integer");
		const record = this._TaskFor(task);
		if (record.state !== DurableTaskStates.Pending)
			throw new Error(`Cannot change attempt for ${record.state} task ${task.taskId}`);
		record.attempt = attempt;
	}

	/** Deliver an event now or queue it until its task asks for the matching event name. */
	async emitEvent<TPayload>(task: DurableTaskReceipt, event: DurableTaskEvent<TPayload>): Promise<DurableEventReceipt>
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
	async cancel(task: DurableTaskReceipt): Promise<DurableTaskReceipt>
	{
		const record = this._TaskFor(task);
		if (record.state === DurableTaskStates.Completed || record.state === DurableTaskStates.Failed)
			return record.receipt;
		record.state = DurableTaskStates.Cancelled;
		const waiter = this.eventWaiters.get(task.taskId);
		if (waiter !== undefined)
		{
			this.eventWaiters.delete(task.taskId);
			waiter.reject(new DurableTaskCancelledError(task.taskId));
		}
		return record.receipt;
	}

	/** Run every pending task in deterministic admission order and report the started worker group. */
	async startWorkers(worker: DurableWorkerStart): Promise<DurableWorkers>
	{
		const workers = new _FakeDurableWorkers(`fake-worker-${this.nextWorkerNumber}`, worker.workerName, this);
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
			if (record.state === DurableTaskStates.Pending)
				await this._RunTask(record);
		}
	}

	/** Return one immutable projection of the current in-memory task state. */
	taskSnapshot(task: DurableTaskReceipt): FakeDurableTaskSnapshot
	{
		const record = this._TaskFor(task);
		return { receipt: record.receipt, state: record.state, result: record.result, error: record.error };
	}

	/** Run one pending child task before returning its result to the parent task. */
	async _AwaitChild<TResult>(task: DurableTaskReceipt): Promise<TResult>
	{
		const record = this._TaskFor(task);
		if (record.state === DurableTaskStates.Pending)
			await this._RunTask(record);
		if (record.state === DurableTaskStates.Cancelled)
			throw new DurableTaskCancelledError(task.taskId);
		if (record.state === DurableTaskStates.Failed)
			throw record.error;
		return record.result as TResult;
	}

	/** Run one task handler and retain its final state for assertions. */
	async _RunTask(record: _FakeTaskRecord): Promise<void>
	{
		this._AssertNotCancelled(record);
		record.state = DurableTaskStates.Running;
		try
		{
			record.result = await record.definition.run(this._ContextFor(record), record.input);
			this._AssertNotCancelled(record);
			record.state = DurableTaskStates.Completed;
		}
		catch (error: unknown)
		{
			if (!this._IsCancelled(record))
			{
				record.error = error;
				record.state = DurableTaskStates.Failed;
			}
		}
	}

	/** Build the engine-neutral task context that delegates every operation to this fake. */
	_ContextFor(record: _FakeTaskRecord): DurableTaskContext
	{
		const self = this;
		return {
			task: record.receipt,
			attempt: record.attempt,
			async checkpoint<TResult>(_step: DurableCheckpointStep, operation: DurableCheckpointOperation<TResult>): Promise<TResult>
			{
				self._AssertNotCancelled(record);
				return operation();
			},
			async waitForEvent<TPayload>(eventName: string): Promise<DurableTaskEvent<TPayload>>
			{
				self._AssertNotCancelled(record);
				const queuedEvents = self.eventsByTask.get(record.receipt.taskId) ?? [];
				const eventIndex = queuedEvents.findIndex(event => event.eventName === eventName);
				if (eventIndex >= 0)
				{
					const event = queuedEvents.splice(eventIndex, 1)[0];
					self.eventsByTask.set(record.receipt.taskId, queuedEvents);
					return event as DurableTaskEvent<TPayload>;
				}
				return new Promise<DurableTaskEvent<TPayload>>(function _wait(resolve, reject)
				{
					self.eventWaiters.set(record.receipt.taskId, { eventName, resolve: _ResolveEvent, reject });

					/** Resolve this generic wait with the engine-neutral stored event. */
					function _ResolveEvent(event: DurableTaskEvent<unknown>): void
					{
						resolve(event as DurableTaskEvent<TPayload>);
					}
				});
			},
			async spawnChild<TInput>(task: DurableTaskSpawn<TInput>): Promise<DurableTaskReceipt>
			{
				return self.spawn({ client: undefined }, task);
			},
			async awaitChild<TResult>(task: DurableTaskReceipt): Promise<TResult>
			{
				return self._AwaitChild<TResult>(task);
			},
			async sleepUntil(instant: Date): Promise<void>
			{
				self._AssertNotCancelled(record);
				if (instant.getTime() > Date.now())
					throw new Error("The fake durable execution cannot advance time");
			},
		};
	}

	/** Return the tracked record after confirming the supplied receipt refers to that exact task. */
	_TaskFor(task: DurableTaskReceipt): _FakeTaskRecord
	{
		const record = this.tasks.get(task.taskId);
		if (record === undefined || record.receipt.taskName !== task.taskName || record.receipt.idempotencyKey !== task.idempotencyKey)
			throw new Error(`Unknown durable task ${task.taskId}`);
		return record;
	}

	/** Throw before a cancelled task can perform another fake engine operation. */
	_AssertNotCancelled(record: _FakeTaskRecord): void
	{
		if (record.state === DurableTaskStates.Cancelled)
			throw new DurableTaskCancelledError(record.receipt.taskId);
	}

	/** Read cancellation through one helper because an async handler may change this record. */
	_IsCancelled(record: _FakeTaskRecord): boolean
	{
		return record.state === DurableTaskStates.Cancelled;
	}
}

/** Worker lifecycle that drains this fake's deterministic pending-task queue. */
class _FakeDurableWorkers implements DurableWorkers
{
	/** Engine-free identifier for this worker group. */
	readonly workerId: string;
	/** Process-local name supplied when this worker group started. */
	readonly workerName: string;
	/** Fake execution whose pending tasks this worker group drains. */
	private readonly execution: __FakeDurableExecution;
	/** Records that this worker group was stopped after its final drain. */
	private stopped = false;

	/** Bind a lifecycle handle to one fake execution instance. */
	constructor(workerId: string, workerName: string, execution: __FakeDurableExecution)
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
	receipt: DurableTaskReceipt;
	/** Registered handler selected by the task receipt. */
	definition: DurableTaskDefinition<unknown, unknown>;
	/** Input captured at task admission. */
	input: unknown;
	/** Positive attempt number supplied to the next handler run. */
	attempt: number;
	/** Current engine-like lifecycle state. */
	state: DurableTaskStates;
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
	resolve: (event: DurableTaskEvent<unknown>) => void;
	/** Reject the wait when cancellation interrupts the task. */
	reject: (error: unknown) => void;
}

/** Build the deterministic map key for a task-name and domain idempotency key pair. */
function _ReceiptKey(taskName: string, idempotencyKey: string): string
{
	return `${taskName}\u0000${idempotencyKey}`;
}
