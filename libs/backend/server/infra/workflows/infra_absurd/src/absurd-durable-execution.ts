import { Absurd, FailedTask, type TaskContext } from "absurd-sdk";
import { Pool } from "pg";

import { ___DoWithTrace } from "@opencrane/backend/observability";
import { DurableExecutionError, DurableTaskNotRegisteredError, DurableTaskRetryBackoffKinds, DurableTaskTerminalError } from "@opencrane/backend/server/infra/workflows/contract";
import type { DurableEventReceipt, DurableExecution, DurableExecutionTransaction, DurableTaskDefinition, DurableTaskEvent, DurableTaskReceipt, DurableTaskRetryPolicy, DurableTaskSpawn, DurableWorkerRuntime, DurableWorkers, DurableWorkerStart } from "@opencrane/backend/server/infra/workflows/contract";

import { _AbsurdTaskScopedIdempotencyKey, PrismaDbProcedureGateway } from "./prisma-db-procedure-gateway";
import type { AbsurdDurableExecutionOptions } from "./absurd-durable-execution.types";
import { _AbsurdTaskContext, _AbsurdTaskEventName } from "./absurd-task-context";
import { _AbsurdTerminalTaskFailure } from "./absurd-terminal-task-failure";
import { AbsurdWorkflowError } from "./absurd-workflow-error";

interface _TaskEnvelope
{
	/** Domain key restored into the engine-neutral task receipt. */
	readonly idempotencyKey: string;
	/** JSON value delivered to the registered task handler. */
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

/** Validate a reviewed task policy and default tasks that do not retry to one attempt. */
function _RetryPolicy(policy: DurableTaskRetryPolicy | undefined): DurableTaskRetryPolicy
{
	const value = policy ?? { maximumAttempts: 1, backoff: { kind: DurableTaskRetryBackoffKinds.Fixed, initialDelaySeconds: 0 } };
	if (!Number.isSafeInteger(value.maximumAttempts) || value.maximumAttempts < 1 || value.maximumAttempts > 100) throw new DurableExecutionError("retryPolicy.maximumAttempts must be between 1 and 100.");
	if (!Number.isSafeInteger(value.backoff.initialDelaySeconds) || value.backoff.initialDelaySeconds < 0 || value.backoff.initialDelaySeconds > 86_400) throw new DurableExecutionError("retryPolicy.initialDelaySeconds must be between 0 and 86400.");
	if (value.backoff.multiplier !== undefined && (!Number.isFinite(value.backoff.multiplier) || value.backoff.multiplier < 0)) throw new DurableExecutionError("retryPolicy.multiplier must be a finite non-negative number.");
	if (value.backoff.maximumDelaySeconds !== undefined && (!Number.isSafeInteger(value.backoff.maximumDelaySeconds) || value.backoff.maximumDelaySeconds < 0 || value.backoff.maximumDelaySeconds > 86_400)) throw new DurableExecutionError("retryPolicy.maximumDelaySeconds must be between 0 and 86400.");
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
 * @see https://github.com/earendil-works/absurd/tree/0.5.0 — the engine revision implemented here.
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
	/** In-flight or completed close shared by concurrent lifecycle callers. */
	private closePromise: Promise<void> | undefined;

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
		const retryPolicy = _RetryPolicy(stored.retryPolicy);
		this.definitions.set(taskName, stored);
		this.engineForQueue(this.queueForTask(taskName)).registerTask({ name: taskName, queue: this.queueForTask(taskName), defaultMaxAttempts: retryPolicy.maximumAttempts }, async (params: unknown, context: TaskContext) => await this.runTask(stored, context, params));
	}

	/** Run a registered handler with the durable receipt reconstructed from its persisted envelope. */
	private async runTask(definition: DurableTaskDefinition<unknown, unknown>, context: TaskContext, params: unknown): Promise<unknown>
	{
		const envelope = _TaskEnvelope(params);
		const task: DurableTaskReceipt = { taskId: context.taskID, taskName: definition.taskName, idempotencyKey: envelope.idempotencyKey };
		try
		{
			return await definition.run(new _AbsurdTaskContext(context, task, this), envelope.inputUndefined ? undefined : envelope.input);
		}
		catch (error)
		{
			if (!(error instanceof DurableTaskTerminalError)) throw error;
			await new _AbsurdTerminalTaskFailure(this.databasePool, this.queueForTask(definition.taskName)).fail(context.taskID, error);
			throw new FailedTask();
		}
	}

	/** Admit a top-level task within the caller's transaction. */
	async spawn<TInput>(transaction: DurableExecutionTransaction, task: DurableTaskSpawn<TInput>): Promise<DurableTaskReceipt>
	{
		const definition = this.definitions.get(task.taskName);
		if (definition === undefined)
		{
			throw new DurableTaskNotRegisteredError(task.taskName);
		}
		return await this.spawnWithTransaction(transaction.client, task, definition);
	}

	/** Admit a task from a running workflow where product-transaction atomicity is not required. */
	async spawnFromTask<TInput>(task: DurableTaskSpawn<TInput>): Promise<DurableTaskReceipt>
	{
		const definition = this.definitions.get(task.taskName);
		if (definition === undefined)
		{
			throw new DurableTaskNotRegisteredError(task.taskName);
		}
		const taskName = _RequiredString("task.taskName", task.taskName);
		const idempotencyKey = _RequiredString("task.idempotencyKey", task.idempotencyKey);
		try
		{
			const envelope = _EnvelopeForTask(idempotencyKey, task.input);
			const policy = _RetryPolicy(definition.retryPolicy);
			const spawned = await this.engineForQueue(this.queueForTask(taskName)).spawn(taskName, envelope, { queue: this.queueForTask(taskName), idempotencyKey: _AbsurdTaskScopedIdempotencyKey(taskName, idempotencyKey), maxAttempts: policy.maximumAttempts, retryStrategy: { kind: policy.backoff.kind, baseSeconds: policy.backoff.initialDelaySeconds, factor: policy.backoff.multiplier, maxSeconds: policy.backoff.maximumDelaySeconds } });
			return { taskId: spawned.taskID, taskName, idempotencyKey };
		}
		catch (error)
		{
			throw new AbsurdWorkflowError("spawn child task", error);
		}
	}

	/** Use the blessed parameterized Absurd function on the caller's existing transaction. */
	private async spawnWithTransaction<TInput>(transactionClient: unknown, task: DurableTaskSpawn<TInput>, definition: DurableTaskDefinition<unknown, unknown>): Promise<DurableTaskReceipt>
	{
		const taskName = _RequiredString("task.taskName", task.taskName);
		const idempotencyKey = _RequiredString("task.idempotencyKey", task.idempotencyKey);
		const policy = _RetryPolicy(definition.retryPolicy);
		const receipt = await new PrismaDbProcedureGateway(this.queueForTask(taskName)).___DbProcedureCall(transactionClient, { taskName, idempotencyKey, input: _EnvelopeForTask(idempotencyKey, task.input), maximumAttempts: policy.maximumAttempts, retryStrategy: { kind: policy.backoff.kind, baseSeconds: policy.backoff.initialDelaySeconds, factor: policy.backoff.multiplier, maxSeconds: policy.backoff.maximumDelaySeconds } });
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
		const queues = [...this.engines.entries()];
		return await ___DoWithTrace("workflow.worker.start", { workerName, queueCount: queues.length, workerConcurrency: this.options.workerConcurrency ?? 1 }, async (): Promise<DurableWorkers> =>
		{
			try
			{
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
				this.options.log?.info({ workerName, queueCount: queues.length, workerConcurrency: this.options.workerConcurrency ?? 1 }, "durable workflow workers started");
				return lifecycle;
			}
			catch (error)
			{
				throw new AbsurdWorkflowError("start workers", error);
			}
		});
	}

	/** Drain the worker group after it stops claiming new tasks. */
	async drainWorkers(workerName: string): Promise<void>
	{
		const workers = this.workerGroups.get(workerName);
		if (workers === undefined)
		{
			return;
		}
		await ___DoWithTrace("workflow.worker.drain", { workerName, workerCount: workers.length }, async (): Promise<void> =>
		{
			try
			{
				await Promise.all(workers.map(async (worker) => await worker.close()));
				this.workerGroups.delete(workerName);
				this.workers.delete(workerName);
				this.options.log?.info({ workerName, workerCount: workers.length }, "durable workflow workers drained");
			}
			catch (error)
			{
				throw new AbsurdWorkflowError("drain workers", error);
			}
		});
	}

	/** Drain every worker group and release the shared SDK connection pool. */
	async close(): Promise<void>
	{
		if (this.closePromise !== undefined)
		{
			return await this.closePromise;
		}
		const closing = ___DoWithTrace("workflow.runtime.close", { workerGroupCount: this.workerGroups.size, ownsDatabasePool: this.ownsDatabasePool }, async (): Promise<void> =>
		{
			await Promise.all([...this.workerGroups.keys()].map(async (workerName) => await this.drainWorkers(workerName)));
			if (this.ownsDatabasePool)
			{
				try { await this.databasePool.end(); }
				catch (error) { throw new AbsurdWorkflowError("close database pool", error); }
			}
			this.options.log?.info({ workerGroupCount: 0, databasePoolClosed: this.ownsDatabasePool }, "durable workflow runtime closed");
		});
		this.closePromise = closing;
		try { await closing; }
		catch (error)
		{
			if (this.closePromise === closing) this.closePromise = undefined;
			throw error;
		}
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
