import { Absurd, type TaskContext } from "absurd-sdk";
import { Pool } from "pg";

import { DurableExecutionError, DurableTaskNotRegisteredError } from "@opencrane/backend/server/infra/workflows/contract";
import type { DurableEventReceipt, DurableExecution, DurableExecutionTransaction, DurableTaskDefinition, DurableTaskEvent, DurableTaskReceipt, DurableTaskSpawn, DurableWorkerRuntime, DurableWorkers, DurableWorkerStart } from "@opencrane/backend/server/infra/workflows/contract";

import { _AbsurdTaskScopedIdempotencyKey, PrismaDbProcedureGateway } from "./prisma-db-procedure-gateway";
import type { AbsurdDurableExecutionOptions } from "./absurd-durable-execution.types";
import { _AbsurdTaskContext, _AbsurdTaskEventName } from "./absurd-task-context";
import { AbsurdWorkflowError } from "./absurd-workflow-error";

interface _TaskEnvelope
{
	readonly idempotencyKey: string;
	readonly input: unknown;
	/** JSON cannot represent undefined, so this preserves an intentionally absent contract input. */
	readonly inputUndefined: boolean;
}

interface _Worker
{
	close(): Promise<void>;
}

/** Require a non-empty engine identity before it becomes a queue, event, or task name. */
function _RequiredString(name: string, value: string): string
{
	if (value.trim().length === 0)
	{
		throw new DurableExecutionError(`${name} must be a non-empty string.`);
	}
	return value;
}

/** Require composition to reserve a bounded shared connection pool for every queue. */
function _DatabasePoolSize(value: number): number
{
	if (!Number.isSafeInteger(value) || value < 1)
	{
		throw new DurableExecutionError("databasePoolSize must be a positive integer.");
	}
	return value;
}

/** Keep task input and its idempotency evidence together for replayed handler contexts. */
function _TaskEnvelope(value: unknown): _TaskEnvelope
{
	if (typeof value !== "object" || value === null || !("idempotencyKey" in value) || !("input" in value) || !("inputUndefined" in value) || typeof value.idempotencyKey !== "string" || typeof value.inputUndefined !== "boolean")
	{
		throw new DurableExecutionError("Absurd task payload is not a durable task envelope.");
	}
	return { idempotencyKey: value.idempotencyKey, input: value.input, inputUndefined: value.inputUndefined };
}

/** Encode an absent input explicitly so JSON persistence does not silently discard the property. */
function _EnvelopeForTask(idempotencyKey: string, input: unknown): _TaskEnvelope
{
	return input === undefined ? { idempotencyKey, input: null, inputUndefined: true } : { idempotencyKey, input, inputUndefined: false };
}

/**
 * The sole Absurd SDK adapter for OpenCrane durable execution.
 *
 * Domain code receives only `DurableExecution`, so an engine swap changes this package rather than
 * every control-plane workflow. The adapter performs top-level admission through the caller's
 * Prisma transaction because an SDK call after commit could be lost on a process crash.
 *
 * ADR 0013 records the engine-boundary and transaction decision.
 */
export class AbsurdDurableExecution implements DurableExecution, DurableWorkerRuntime
{
	/** Per-queue SDK clients; child awaits require separately drained worker queues. */
	private readonly engines = new Map<string, Absurd>();
	/** Registered definitions used to validate admissions and build task contexts. */
	private readonly definitions = new Map<string, DurableTaskDefinition<unknown, unknown>>();
	/** Engine worker groups started for this process. */
	private readonly workerGroups = new Map<string, readonly _Worker[]>();
	/** Public lifecycle objects retained so repeat starts return the original worker group. */
	private readonly workers = new Map<string, DurableWorkers>();
	/** Connection and task-queue configuration supplied by application composition. */
	private readonly options: AbsurdDurableExecutionOptions;
	/** One bounded database pool shared by all Absurd queues in this process. */
	private readonly databasePool: Pool;
	/** Whether this adapter created and therefore closes the shared pool. */
	private readonly ownsDatabasePool: boolean;

	/** Creates an adapter without opening workers before registration is complete. */
	constructor(options: AbsurdDurableExecutionOptions)
	{
		this.options = { ...options, databaseUrl: _RequiredString("databaseUrl", options.databaseUrl), databasePoolSize: _DatabasePoolSize(options.databasePoolSize) };
		this.ownsDatabasePool = options.databasePool === undefined;
		this.databasePool = options.databasePool ?? new Pool({ connectionString: this.options.databaseUrl, max: this.options.databasePoolSize });
	}

	/** Resolve a task through the immutable authority that workflow composition also gives the kit. */
	queueForTask(taskName: string): string
	{
		const name = _RequiredString("taskName", taskName);
		return _RequiredString("queue", this.options.queueAuthority.queueForTask(name));
	}

	/** Create one engine client for each configured queue only when a task needs it. */
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

	/** Register a contract task with its queue-specific Absurd client. */
	register<TInput, TResult>(definition: DurableTaskDefinition<TInput, TResult>): void
	{
		const taskName = _RequiredString("definition.taskName", definition.taskName);
		if (this.definitions.has(taskName))
		{
			throw new DurableExecutionError(`Durable task ${taskName} is already registered.`);
		}
		const stored = definition as unknown as DurableTaskDefinition<unknown, unknown>;
		this.definitions.set(taskName, stored);
		this.engineForQueue(this.queueForTask(taskName)).registerTask({ name: taskName, queue: this.queueForTask(taskName) }, async (params: unknown, context: TaskContext) => await this.runTask(stored, context, params));
	}

	/** Run a registered handler with the durable receipt reconstructed from its persisted envelope. */
	private async runTask(definition: DurableTaskDefinition<unknown, unknown>, context: TaskContext, params: unknown): Promise<unknown>
	{
		const envelope = _TaskEnvelope(params);
		const task: DurableTaskReceipt = { taskId: context.taskID, taskName: definition.taskName, idempotencyKey: envelope.idempotencyKey };
		return await definition.run(new _AbsurdTaskContext(context, task, this), envelope.inputUndefined ? undefined : envelope.input);
	}

	/** Admit a top-level task within the caller's transaction. */
	async spawn<TInput>(transaction: DurableExecutionTransaction, task: DurableTaskSpawn<TInput>): Promise<DurableTaskReceipt>
	{
		const definition = this.definitions.get(task.taskName);
		if (definition === undefined)
		{
			throw new DurableTaskNotRegisteredError(task.taskName);
		}
		return await this.spawnWithTransaction(transaction.client, task);
	}

	/** Admit a task from a running workflow where product-transaction atomicity is not required. */
	async spawnFromTask<TInput>(task: DurableTaskSpawn<TInput>): Promise<DurableTaskReceipt>
	{
		if (!this.definitions.has(task.taskName))
		{
			throw new DurableTaskNotRegisteredError(task.taskName);
		}
		const taskName = _RequiredString("task.taskName", task.taskName);
		const idempotencyKey = _RequiredString("task.idempotencyKey", task.idempotencyKey);
		try
		{
			const envelope = _EnvelopeForTask(idempotencyKey, task.input);
			const spawned = await this.engineForQueue(this.queueForTask(taskName)).spawn(taskName, envelope, { queue: this.queueForTask(taskName), idempotencyKey: _AbsurdTaskScopedIdempotencyKey(taskName, idempotencyKey) });
			return { taskId: spawned.taskID, taskName, idempotencyKey };
		}
		catch (error)
		{
			throw new AbsurdWorkflowError("spawn child task", error);
		}
	}

	/** Use the blessed parameterized Absurd function on the caller's existing transaction. */
	private async spawnWithTransaction<TInput>(transactionClient: unknown, task: DurableTaskSpawn<TInput>): Promise<DurableTaskReceipt>
	{
		const taskName = _RequiredString("task.taskName", task.taskName);
		const idempotencyKey = _RequiredString("task.idempotencyKey", task.idempotencyKey);
		const receipt = await new PrismaDbProcedureGateway(this.queueForTask(taskName)).___DbProcedureCall(transactionClient, { taskName, idempotencyKey, input: _EnvelopeForTask(idempotencyKey, task.input) });
		return { taskId: receipt.taskId, taskName, idempotencyKey };
	}

	/** Deliver one immutable event to the queue that owns its waiting task. */
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

	/** Cancel an incomplete task in the queue selected for its registered definition. */
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

	/** Start and retain one drainable worker for each queue that contains a registered task. */
	async startWorkers(worker: DurableWorkerStart): Promise<DurableWorkers>
	{
		const workerName = _RequiredString("worker.workerName", worker.workerName);
		const existing = this.workers.get(workerName);
		if (existing !== undefined)
		{
			return existing;
		}
		try
		{
			const queues = [...this.engines.entries()];
			const workers = await Promise.all(queues.map(async ([queueName, engine]) => await engine.startWorker({ workerId: `${workerName}:${queueName}`, concurrency: this.options.workerConcurrency, pollInterval: this.options.pollIntervalMs === undefined ? undefined : this.options.pollIntervalMs / 1000 })));
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

	/** Drain the worker group after it stops claiming new tasks. */
	async drainWorkers(workerName: string): Promise<void>
	{
		const workers = this.workerGroups.get(workerName);
		if (workers === undefined)
		{
			return;
		}
		this.workerGroups.delete(workerName);
		this.workers.delete(workerName);
		await Promise.all(workers.map(async (worker) => await worker.close()));
	}

	/** Drain every worker group and release the shared SDK connection pool. */
	async close(): Promise<void>
	{
		await Promise.all([...this.workerGroups.keys()].map(async (workerName) => await this.drainWorkers(workerName)));
		if (this.ownsDatabasePool) await this.databasePool.end();
	}
}

/**
 * Creates the durable-execution and worker-lifecycle ports without returning an Absurd SDK object.
 *
 * Application composition uses this factory to keep the engine boundary at this package; domains
 * receive {@link DurableExecution} instead.
 */
export function _CreateAbsurdDurableExecution(options: AbsurdDurableExecutionOptions): DurableExecution & DurableWorkerRuntime
{
	return new AbsurdDurableExecution(options);
}
