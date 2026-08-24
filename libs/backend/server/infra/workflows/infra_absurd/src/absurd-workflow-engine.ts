import { Absurd, type TaskContext } from "absurd-sdk";
import { Pool } from "pg";

import { DurableExecutionError, DurableTaskNotRegisteredError } from "@opencrane/backend/server/infra/workflows/contract";
import type { DurableEventReceipt, DurableExecution, DurableExecutionTransaction, DurableTaskDefinition, DurableTaskEvent, DurableTaskReceipt, DurableTaskSpawn, DurableWorkerRuntime, DurableWorkers, DurableWorkerStart } from "@opencrane/backend/server/infra/workflows/contract";

import { _AbsurdTaskScopedIdempotencyKey, PrismaDbProcedureGateway } from "./prisma-db-procedure-gateway";
import type { IAbsurdWorkflowEngineOptions } from "./absurd-workflow-engine.types";
import { _AbsurdTaskContext, _AbsurdTaskEventName } from "./absurd-task-context";
import { AbsurdWorkflowError } from "./absurd-workflow-error";

/** Preserves the caller's idempotency key and an intentionally absent JSON input. */
interface ITaskEnvelope
{
	/** Domain key restored into the engine-neutral task receipt. */
	readonly idempotencyKey: string;
	/** JSON value delivered to the registered task handler. */
	readonly input: unknown;
	/** JSON cannot represent undefined, so this preserves an intentionally absent contract input. */
	readonly inputUndefined: boolean;
}

/** Defines the worker shutdown operation that the Absurd SDK exposes. */
interface IWorker
{
	/** Stops the worker after it finishes its current operation. */
	close(): Promise<void>;
}

/** Rejects an empty name before it becomes a persisted queue, event, or task identity. */
function _RequiredString(name: string, value: string): string
{
	if (value.trim().length === 0)
	{
		throw new DurableExecutionError(`${name} must be a non-empty string.`);
	}
	return value;
}

/** Rejects an invalid shared-pool limit before the engine creates database connections. */
function _DatabasePoolSize(value: number): number
{
	if (!Number.isSafeInteger(value) || value < 1)
	{
		throw new DurableExecutionError("databasePoolSize must be a positive integer.");
	}
	return value;
}

/** Validates the persisted envelope before a worker reconstructs the contract task input. */
function _TaskEnvelope(value: unknown): ITaskEnvelope
{
	if (typeof value !== "object" || value === null || !("idempotencyKey" in value) || !("input" in value) || !("inputUndefined" in value) || typeof value.idempotencyKey !== "string" || typeof value.inputUndefined !== "boolean")
	{
		throw new DurableExecutionError("Absurd task payload is not a durable task envelope.");
	}
	return { idempotencyKey: value.idempotencyKey, input: value.input, inputUndefined: value.inputUndefined };
}

/** Encodes an absent input explicitly because JSON persistence would otherwise drop the property. */
function _EnvelopeForTask(idempotencyKey: string, input: unknown): ITaskEnvelope
{
	return input === undefined ? { idempotencyKey, input: null, inputUndefined: true } : { idempotencyKey, input, inputUndefined: false };
}

/**
 * Implements the Absurd-backed workflow engine behind OpenCrane's durable-execution ports.
 *
 * Domain code receives {@link DurableExecution}, not this vendor implementation, so an engine
 * change stays in this package. For top-level work, {@link spawn} calls the reviewed PostgreSQL
 * procedure inside the caller's transaction: the product write and task admission therefore share
 * one commit decision. Work that a running task creates uses the SDK directly because it has no
 * surrounding product transaction to join.
 *
 * The engine owns task registration, queue-scoped SDK clients, and worker groups. It does not
 * choose queues: composition supplies the same reviewed authority that the workflow kit uses.
 * Call {@link close} during process shutdown; it drains workers before releasing an engine-owned
 * database pool.
 *
 * Called by: {@link _CreateDurableExecutionQualificationSession} for the live qualification run.
 * @see ../../../../../../../docs/adr/0013-durable-control-plane-execution.md — records the engine boundary and transaction decision.
 * @see https://github.com/earendil-works/absurd/tree/0.5.0 — the engine revision implemented here.
 */
export class AbsurdWorkflowEngine implements DurableExecution, DurableWorkerRuntime
{
	/** Stores one SDK client per reviewed queue after a registered task first needs it. */
	private readonly engines = new Map<string, Absurd>();
	/** Stores registered definitions so every admission and task context uses the same contract. */
	private readonly definitions = new Map<string, DurableTaskDefinition<unknown, unknown>>();
	/** Stores SDK workers that must drain before a process releases this engine's resources. */
	private readonly workerGroups = new Map<string, readonly IWorker[]>();
	/** Stores lifecycle handles so a repeated start for one name returns the existing group. */
	private readonly workers = new Map<string, DurableWorkers>();
	/** Stores database, queue, and worker settings selected by application composition. */
	private readonly options: IAbsurdWorkflowEngineOptions;
	/** Shares one bounded database pool across every queue in this process. */
	private readonly databasePool: Pool;
	/** Records whether this engine created the shared pool and must close it. */
	private readonly ownsDatabasePool: boolean;

	/**
	 * Creates the engine without starting workers before task registration is complete.
	 *
	 * @param options Database ownership, reviewed queue selection, and worker settings.
	 */
	constructor(options: IAbsurdWorkflowEngineOptions)
	{
		// 1. Validate connection settings before any SDK client can use them.
		this.options = { ...options, databaseUrl: _RequiredString("databaseUrl", options.databaseUrl), databasePoolSize: _DatabasePoolSize(options.databasePoolSize) };
		// 2. Retain ownership so close never releases a caller-shared pool.
		this.ownsDatabasePool = options.databasePool === undefined;
		// 3. Create the shared pool lazily used by queue-specific SDK clients.
		this.databasePool = options.databasePool ?? new Pool({ connectionString: this.options.databaseUrl, max: this.options.databasePoolSize });
	}

	/**
	 * Resolves a task through the queue authority shared with workflow composition.
	 *
	 * The authority rejects an unreviewed task instead of allowing this adapter to choose a fallback
	 * queue, which preserves the queue policy that the workflow kit already validated.
	 */
	queueForTask(taskName: string): string
	{
		const name = _RequiredString("taskName", taskName);
		return _RequiredString("queue", this.options.queueAuthority.queueForTask(name));
	}

	/** Creates one SDK client for a reviewed queue the first time a task needs it. */
	private engineForQueue(queueName: string): Absurd
	{
		const existing = this.engines.get(queueName);
		if (existing !== undefined)
		{
			return existing;
		}
		const engine = new Absurd({ db: this.databasePool, queueName });
		this.engines.set(queueName, engine);
		return engine;
	}

	/**
	 * Registers a contract task on its reviewed Absurd queue.
	 *
	 * Registration precedes every admission, so the engine can reject an unknown task name instead
	 * of persisting work that no handler owns. The stored definition also becomes the source for the
	 * replay-safe context that {@link runTask} passes to each handler.
	 */
	register<TInput, TResult>(definition: DurableTaskDefinition<TInput, TResult>): void
	{
		const taskName = _RequiredString("definition.taskName", definition.taskName);
		// 1. Refuse a duplicate before either registry can disagree about its handler.
		if (this.definitions.has(taskName))
		{
			throw new DurableExecutionError(`Durable task ${taskName} is already registered.`);
		}
		// 2. Retain the definition that admissions and worker contexts will share.
		const stored = definition as unknown as DurableTaskDefinition<unknown, unknown>;
		this.definitions.set(taskName, stored);
		// 3. Bind the vendor handler to the same reviewed queue before any task can be admitted.
		this.engineForQueue(this.queueForTask(taskName)).registerTask({ name: taskName, queue: this.queueForTask(taskName) }, async (params: unknown, context: TaskContext) => await this.runTask(stored, context, params));
	}

	/**
	 * Runs a registered handler after restoring its receipt and input from the persisted envelope.
	 *
	 * The envelope keeps `undefined` distinct from JSON `null`, so replay uses the input contract
	 * that the caller admitted instead of silently changing an absent value into `null`.
	 */
	private async runTask(definition: DurableTaskDefinition<unknown, unknown>, context: TaskContext, params: unknown): Promise<unknown>
	{
		// 1. Reject malformed persisted data before it reaches domain code.
		const envelope = _TaskEnvelope(params);
		// 2. Rebuild the engine-neutral receipt that the handler may safely retain.
		const task: DurableTaskReceipt = { taskId: context.taskID, taskName: definition.taskName, idempotencyKey: envelope.idempotencyKey };
		// 3. Give the handler a context that routes child work and events through this engine.
		return await definition.run(new _AbsurdTaskContext(context, task, this), envelope.inputUndefined ? undefined : envelope.input);
	}

	/**
	 * Admits a top-level task through the caller's open product transaction.
	 *
	 * The PostgreSQL procedure records the task before that transaction commits. A process crash
	 * cannot leave a committed product change without the work it requires.
	 * @see PrismaDbProcedureGateway — owns the fixed, parameterized procedure call.
	 */
	async spawn<TInput>(transaction: DurableExecutionTransaction, task: DurableTaskSpawn<TInput>): Promise<DurableTaskReceipt>
	{
		// 1. Verify the task has a handler before persisting an unserviceable receipt.
		const definition = this.definitions.get(task.taskName);
		if (definition === undefined)
		{
			throw new DurableTaskNotRegisteredError(task.taskName);
		}
		// 2. Use the caller's transaction so the product write and receipt commit together.
		return await this.spawnWithTransaction(transaction.client, task);
	}

	/**
	 * Starts a child task from a running workflow through the SDK.
	 *
	 * A running task has no caller-owned product transaction to join. The task-scoped idempotency
	 * key prevents two task definitions on one queue from treating the same domain key as a match.
	 */
	async spawnFromTask<TInput>(task: DurableTaskSpawn<TInput>): Promise<DurableTaskReceipt>
	{
		// 1. Reject a missing handler before asking the SDK to persist child work.
		if (!this.definitions.has(task.taskName))
		{
			throw new DurableTaskNotRegisteredError(task.taskName);
		}
		const taskName = _RequiredString("task.taskName", task.taskName);
		const idempotencyKey = _RequiredString("task.idempotencyKey", task.idempotencyKey);
		try
		{
			// 2. Preserve an absent input and scope the key before it reaches the shared queue.
			const envelope = _EnvelopeForTask(idempotencyKey, task.input);
			const spawned = await this.engineForQueue(this.queueForTask(taskName)).spawn(taskName, envelope, { queue: this.queueForTask(taskName), idempotencyKey: _AbsurdTaskScopedIdempotencyKey(taskName, idempotencyKey) });
			return { taskId: spawned.taskID, taskName, idempotencyKey };
		}
		catch (error)
		{
			throw new AbsurdWorkflowError("spawn child task", error);
		}
	}

	/** Calls the fixed, parameterized Absurd procedure on the caller's existing transaction. */
	private async spawnWithTransaction<TInput>(transactionClient: unknown, task: DurableTaskSpawn<TInput>): Promise<DurableTaskReceipt>
	{
		const taskName = _RequiredString("task.taskName", task.taskName);
		const idempotencyKey = _RequiredString("task.idempotencyKey", task.idempotencyKey);
		const receipt = await new PrismaDbProcedureGateway(this.queueForTask(taskName)).___DbProcedureCall(transactionClient, { taskName, idempotencyKey, input: _EnvelopeForTask(idempotencyKey, task.input) });
		return { taskId: receipt.taskId, taskName, idempotencyKey };
	}

	/**
	 * Delivers an event to the queue that owns the waiting task.
	 *
	 * The event name includes the task identifier, so two tasks waiting for the same application
	 * event name cannot receive each other's payload.
	 */
	async emitEvent<TPayload>(task: DurableTaskReceipt, event: DurableTaskEvent<TPayload>): Promise<DurableEventReceipt>
	{
		const eventName = _RequiredString("event.eventName", event.eventName);
		try
		{
			await this.engineForQueue(this.queueForTask(task.taskName)).emitEvent(_AbsurdTaskEventName(task.taskId, eventName), event.payload as never, this.queueForTask(task.taskName));
			return { task, eventName };
		}
		catch (error)
		{
			throw new AbsurdWorkflowError("emit event", error);
		}
	}

	/** Cancels an incomplete task through the reviewed queue that owns its task definition. */
	async cancel(task: DurableTaskReceipt): Promise<DurableTaskReceipt>
	{
		try
		{
			await this.engineForQueue(this.queueForTask(task.taskName)).cancelTask(task.taskId, this.queueForTask(task.taskName));
			return task;
		}
		catch (error)
		{
			throw new AbsurdWorkflowError("cancel task", error);
		}
	}

	/**
	 * Starts and retains a drainable worker for every queue with a registered task.
	 *
	 * Repeating a start with the same worker name returns the original lifecycle handle rather than
	 * starting a duplicate group. Each queue gets its own SDK worker because Absurd scopes worker
	 * polling and task dispatch to a queue.
	 */
	async startWorkers(worker: DurableWorkerStart): Promise<DurableWorkers>
	{
		const workerName = _RequiredString("worker.workerName", worker.workerName);
		// 1. Reuse the existing group so repeated server start calls do not double dispatch work.
		const existing = this.workers.get(workerName);
		if (existing !== undefined)
		{
			return existing;
		}
		try
		{
			// 2. Start one SDK worker per queue after all registrations created their clients.
			const queues = [...this.engines.entries()];
			const workers = await Promise.all(queues.map(async ([queueName, engine]) => await engine.startWorker({ workerId: `${workerName}:${queueName}`, concurrency: this.options.workerConcurrency, pollInterval: this.options.pollIntervalMs === undefined ? undefined : this.options.pollIntervalMs / 1000 })));
			// 3. Retain both SDK workers and the engine-neutral shutdown handle.
			this.workerGroups.set(workerName, workers);
			const execution = this;
			const lifecycle: DurableWorkers = {
				workerId: workerName,
				workerName,
				async drain(): Promise<void> { await execution.drainWorkers(workerName); },
				async stop(): Promise<void> { await execution.drainWorkers(workerName); },
			};
			this.workers.set(workerName, lifecycle);
			return lifecycle;
		}
		catch (error)
		{
			throw new AbsurdWorkflowError("start workers", error);
		}
	}

	/**
	 * Drains a named worker group and removes its lifecycle handles.
	 *
	 * The maps are cleared before closing workers so repeated shutdown calls do not attempt to drain
	 * the same SDK workers again.
	 */
	async drainWorkers(workerName: string): Promise<void>
	{
		const workers = this.workerGroups.get(workerName);
		if (workers === undefined)
		{
			return;
		}
		// 1. Forget the group before awaiting shutdown so retries cannot close it twice.
		this.workerGroups.delete(workerName);
		this.workers.delete(workerName);
		// 2. Let every queue worker finish its accepted work before process resources disappear.
		await Promise.all(workers.map(async (worker) => await worker.close()));
	}

	/**
	 * Drains every worker group before releasing this engine's shared database pool.
	 *
	 * A caller-provided pool remains open because its owner can share it with other resources. An
	 * engine-created pool closes only after workers finish, as workers still use database connections
	 * while they drain.
	 */
	async close(): Promise<void>
	{
		await Promise.all([...this.workerGroups.keys()].map(async (workerName) => await this.drainWorkers(workerName)));
		if (this.ownsDatabasePool) await this.databasePool.end();
	}
}
