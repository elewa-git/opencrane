import { Absurd, FailedTask, type TaskContext } from "absurd-sdk";
import pg, { type Pool as PgPool } from "pg";

import { ___DoWithTrace } from "@opencrane/backend/observability";
import { WorkflowError, WorkflowTaskNotDeclaredError, WorkflowTaskNotRegisteredError, WorkflowTaskRetryBackoffKinds, WorkflowTaskTerminalError } from "@opencrane/backend/server/infra/workflows/contract";
import type { IWorkflowEngine, IWorkflowTaskDeclaration, IWorkflowTaskDefinition, IWorkflowTaskEvent, IWorkflowTaskEventReceipt, IWorkflowTaskReceipt, IWorkflowTaskRetryPolicy, IWorkflowTaskSpawn, IWorkflowTransaction, IWorkflowWorkerRuntime, IWorkflowWorkers, IWorkflowWorkerStart } from "@opencrane/backend/server/infra/workflows/contract";

import { _TaskScopedIdempotencyKey, WorkflowTaskAdmission } from "./workflow-task-admission";
import type { IAbsurdWorkflowEngineOptions } from "./absurd-workflow-engine.types";
import { _AbsurdTaskContext, _AbsurdTaskEventName } from "./absurd-task-context";
import { _AbsurdTerminalTaskFailure } from "./absurd-terminal-task-failure";
import type { IWorkflowTaskAdmissionRequest } from "./workflow-task-admission.types";
import { AbsurdWorkflowError } from "./absurd-workflow-error";

const { Pool } = pg;

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

/** Describes the claimed task field that Absurd 0.5.0 omits from its public context type. */
interface IAbsurdTaskContextRuntime
{
	/** Claimed task data supplied by the worker runtime. */
	readonly task: { readonly attempt: unknown };
}

/** Rejects an empty name before it becomes a persisted queue, event, or task identity. */
function _RequiredString(name: string, value: string): string
{
	if (value.trim().length === 0)
	{
		throw new WorkflowError(`${name} must be a non-empty string.`);
	}
	return value;
}

/** Rejects an invalid shared-pool limit before the engine creates database connections. */
function _DatabasePoolSize(value: number): number
{
	if (!Number.isSafeInteger(value) || value < 1)
	{
		throw new WorkflowError("databasePoolSize must be a positive integer.");
	}
	return value;
}

/** Validates a task retry policy and defaults tasks that do not retry to one attempt. */
function _RetryPolicy(policy: IWorkflowTaskRetryPolicy | undefined): IWorkflowTaskRetryPolicy
{
	const value = policy ?? { maximumAttempts: 1, backoff: { kind: WorkflowTaskRetryBackoffKinds.Fixed, initialDelaySeconds: 0 } };
	if (!Number.isSafeInteger(value.maximumAttempts) || value.maximumAttempts < 1 || value.maximumAttempts > 100)
		throw new WorkflowError("retryPolicy.maximumAttempts must be between 1 and 100.");
	if (!Number.isSafeInteger(value.backoff.initialDelaySeconds) || value.backoff.initialDelaySeconds < 0 || value.backoff.initialDelaySeconds > 86_400)
		throw new WorkflowError("retryPolicy.initialDelaySeconds must be between 0 and 86400.");
	if (value.backoff.multiplier !== undefined && (!Number.isFinite(value.backoff.multiplier) || value.backoff.multiplier < 0))
		throw new WorkflowError("retryPolicy.multiplier must be a finite non-negative number.");
	if (value.backoff.maximumDelaySeconds !== undefined && (!Number.isSafeInteger(value.backoff.maximumDelaySeconds) || value.backoff.maximumDelaySeconds < 0 || value.backoff.maximumDelaySeconds > 86_400))
		throw new WorkflowError("retryPolicy.maximumDelaySeconds must be between 0 and 86400.");
	return value;
}

/** Compare normalized retry policies by their reviewed values instead of JSON property order. */
function _SameRetryPolicy(left: IWorkflowTaskRetryPolicy, right: IWorkflowTaskRetryPolicy): boolean
{
	return left.maximumAttempts === right.maximumAttempts && left.backoff.kind === right.backoff.kind && left.backoff.initialDelaySeconds === right.backoff.initialDelaySeconds && left.backoff.multiplier === right.backoff.multiplier && left.backoff.maximumDelaySeconds === right.backoff.maximumDelaySeconds;
}

/** Converts the shared retry policy to the field names used by Absurd admission. */
function _AbsurdRetryPolicy(policy: IWorkflowTaskRetryPolicy | undefined): Pick<IWorkflowTaskAdmissionRequest, "maximumAttempts" | "retryStrategy">
{
	const value = _RetryPolicy(policy);
	return { maximumAttempts: value.maximumAttempts, retryStrategy: { kind: value.backoff.kind, baseSeconds: value.backoff.initialDelaySeconds, factor: value.backoff.multiplier, maxSeconds: value.backoff.maximumDelaySeconds } };
}

/** Validates the persisted envelope before a worker reconstructs the contract task input. */
function _TaskEnvelope(value: unknown): ITaskEnvelope
{
	if (typeof value !== "object" || value === null || !("idempotencyKey" in value) || !("input" in value) || !("inputUndefined" in value) || typeof value.idempotencyKey !== "string" || typeof value.inputUndefined !== "boolean")
	{
		throw new WorkflowError("Absurd task payload is not a workflow task envelope.");
	}
	return { idempotencyKey: value.idempotencyKey, input: value.input, inputUndefined: value.inputUndefined };
}

/**
 * Reads the attempt that Absurd supplies at runtime but omits from its public `TaskContext` type.
 *
 * Rejecting a missing value prevents retry handling from receiving a made-up attempt number.
 * @see https://github.com/earendil-works/absurd/tree/0.5.0 — supplies `task.attempt` at runtime.
 */
function _AbsurdTaskAttempt(context: TaskContext): number
{
	const attempt = (context as unknown as IAbsurdTaskContextRuntime).task?.attempt;
	if (!Number.isSafeInteger(attempt) || (attempt as number) < 1)
	{
		throw new WorkflowError("Absurd task attempt is not a positive integer.");
	}
	return attempt as number;
}

/** Encodes an absent input explicitly because JSON persistence would otherwise drop the property. */
function _EnvelopeForTask(idempotencyKey: string, input: unknown): ITaskEnvelope
{
	return input === undefined ? { idempotencyKey, input: null, inputUndefined: true } : { idempotencyKey, input, inputUndefined: false };
}

/**
 * Implements the Absurd-backed workflow engine behind OpenCrane's workflow-engine ports.
 *
 * Domain code receives {@link IWorkflowEngine}, not this vendor implementation, so an engine
 * change stays in this package. For top-level work, {@link spawn} calls the reviewed PostgreSQL
 * procedure inside the caller's transaction: the product write and task admission therefore share
 * one commit decision. Work that a running task creates uses the SDK directly because it has no
 * surrounding product transaction to join.
 *
 * The engine owns admission declarations, local task registration, queue-scoped SDK clients, and
 * worker groups. A declaration permits transactional top-level admission even when a remote
 * controller owns the handler; a child task still needs a local handler. It does not choose queues:
 * composition supplies the same reviewed authority that the workflow guard uses. Call {@link close}
 * during process shutdown; it drains workers before releasing an engine-owned database pool.
 *
 * Called by: {@link _CreateWorkflowEngineQualificationSession} for the live qualification run.
 * @see ../../../../../../../docs/adr/0013-workflow-control-plane.md — records the engine boundary and transaction decision.
 * @see https://github.com/earendil-works/absurd/tree/0.5.0 — the engine revision implemented here.
 */
export class AbsurdWorkflowEngine implements IWorkflowEngine, IWorkflowWorkerRuntime
{
	/** Stores one SDK client per reviewed queue after a registered task first needs it. */
	private readonly engines = new Map<string, Absurd>();
	/** Stores registered definitions so every admission and task context uses the same contract. */
	private readonly definitions = new Map<string, IWorkflowTaskDefinition<unknown, unknown>>();
	/** Stores admission-only declarations that deliberately have no local worker handler. */
	private readonly declarations = new Map<string, IWorkflowTaskDeclaration>();
	/** Stores SDK workers that must drain before a process releases this engine's resources. */
	private readonly workerGroups = new Map<string, readonly IWorker[]>();
	/** Stores lifecycle handles so a repeated start for one name returns the existing group. */
	private readonly workers = new Map<string, IWorkflowWorkers>();
	/** Stores database, queue, and worker settings selected by application composition. */
	private readonly options: IAbsurdWorkflowEngineOptions;
	/** Shares one bounded database pool across every queue in this process. */
	private readonly databasePool: PgPool;
	/** Records whether this engine created the shared pool and must close it. */
	private readonly ownsDatabasePool: boolean;
	/** Shares one shutdown promise across concurrent lifecycle callers. */
	private closePromise: Promise<void> | undefined;

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
	 * queue, which preserves the queue policy that the workflow guard already validated.
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
	 * Registration also creates its admission declaration, then binds the local SDK handler. Use
	 * {@link declare} instead when a remote controller owns that handler. The stored definition becomes
	 * the source for the replay-safe context that {@link runTask} passes to each local handler.
	 */
	register<TInput, TResult>(definition: IWorkflowTaskDefinition<TInput, TResult>): void
	{
		const taskName = _RequiredString("definition.taskName", definition.taskName);
		this.declare(definition);
		// 1. Refuse a duplicate before either registry can disagree about its handler.
		if (this.definitions.has(taskName))
		{
			throw new WorkflowError(`Workflow task ${taskName} is already registered.`);
		}
		// 2. Retain the definition that admissions and worker contexts will share.
		const stored = definition as unknown as IWorkflowTaskDefinition<unknown, unknown>;
		const retryPolicy = _RetryPolicy(stored.retryPolicy);
		this.definitions.set(taskName, stored);
		// 3. Bind the vendor handler to the same reviewed queue before any task can be admitted.
		const engine = this;
		this.engineForQueue(this.queueForTask(taskName)).registerTask({ name: taskName, queue: this.queueForTask(taskName), defaultMaxAttempts: retryPolicy.maximumAttempts }, async function _RunTask(params: unknown, context: TaskContext): Promise<unknown> { return await engine.runTask(stored, context, params); });
	}

	/**
	 * Declares one reviewed task for transactional top-level admission without creating a local handler.
	 *
	 * Use this when a remote controller registers the handler: the server can admit work in its product
	 * transaction, but {@link spawnFromTask} still rejects the task because child work needs a local
	 * SDK handler. A conflicting retry policy fails rather than changing what an existing declaration
	 * permits.
	 *
	 * @param declaration - Task name and retry policy allowed to enter transactional admission.
	 * @throws WorkflowError when the declaration conflicts with an existing task or queue policy.
	 */
	declare(declaration: IWorkflowTaskDeclaration): void
	{
		const taskName = _RequiredString("declaration.taskName", declaration.taskName);
		const existing = this.declarations.get(taskName);
		const retryPolicy = _RetryPolicy(declaration.retryPolicy);
		if (existing !== undefined && !_SameRetryPolicy(_RetryPolicy(existing.retryPolicy), retryPolicy))
		{
			throw new WorkflowError(`Workflow task ${taskName} has a different declaration.`);
		}
		this.queueForTask(taskName);
		this.declarations.set(taskName, { taskName, retryPolicy });
	}

	/**
	 * Runs a registered handler after restoring its receipt and input from the persisted envelope.
	 *
	 * The envelope keeps `undefined` distinct from JSON `null`, so replay uses the input contract
	 * that the caller admitted instead of silently changing an absent value into `null`.
	 */
	private async runTask(definition: IWorkflowTaskDefinition<unknown, unknown>, context: TaskContext, params: unknown): Promise<unknown>
	{
		// 1. Reject malformed persisted data before it reaches domain code.
		const envelope = _TaskEnvelope(params);
		// 2. Rebuild the engine-neutral receipt that the handler may safely retain.
		const task: IWorkflowTaskReceipt = { taskId: context.taskID, taskName: definition.taskName, idempotencyKey: envelope.idempotencyKey };
		// 3. Give the handler a context that routes child work and events through this engine.
		try
		{
			return await definition.run(new _AbsurdTaskContext(context, task, _AbsurdTaskAttempt(context), this), envelope.inputUndefined ? undefined : envelope.input);
		}
		catch (error)
		{
			if (!(error instanceof WorkflowTaskTerminalError))
				throw error;
			await new _AbsurdTerminalTaskFailure(this.databasePool, this.queueForTask(definition.taskName)).fail(context.taskID, error);
			throw new FailedTask();
		}
	}

	/**
	 * Admits a top-level task through the caller's open product transaction.
	 *
	 * The PostgreSQL procedure records the task before that transaction commits. A process crash
	 * cannot leave a committed product change without the work it requires.
	 * A reviewed declaration is enough here because a remote controller may register the handler.
	 * @see declare — admits remote-controller work without installing a local handler.
	 * @see WorkflowTaskAdmission — owns the fixed, parameterized procedure call.
	 */
	async spawn<TInput>(transaction: IWorkflowTransaction, task: IWorkflowTaskSpawn<TInput>): Promise<IWorkflowTaskReceipt>
	{
		// 1. Verify the task has a reviewed declaration; its handler may run in another process.
		const declaration = this.declarations.get(task.taskName);
		if (declaration === undefined)
		{
			throw new WorkflowTaskNotDeclaredError(task.taskName);
		}
		// 2. Use the caller's transaction so the product write and receipt commit together.
		return await this.spawnWithTransaction(transaction.client, task, declaration);
	}

	/**
	 * Starts a child task from a running workflow through the SDK.
	 *
	 * A running task has no caller-owned product transaction to join. The task-scoped idempotency
	 * key prevents two task definitions on one queue from treating the same domain key as a match.
	 * Unlike {@link spawn}, this operation requires a local registered handler because the SDK persists
	 * and dispatches the child work from this process.
	 */
	async spawnFromTask<TInput>(task: IWorkflowTaskSpawn<TInput>): Promise<IWorkflowTaskReceipt>
	{
		// 1. Reject a missing handler before asking the SDK to persist child work.
		const definition = this.definitions.get(task.taskName);
		if (definition === undefined)
		{
			throw new WorkflowTaskNotRegisteredError(task.taskName);
		}
		const taskName = _RequiredString("task.taskName", task.taskName);
		const idempotencyKey = _RequiredString("task.idempotencyKey", task.idempotencyKey);
		try
		{
			// 2. Preserve an absent input and scope the key before it reaches the shared queue.
			const envelope = _EnvelopeForTask(idempotencyKey, task.input);
			const retry = _AbsurdRetryPolicy(definition.retryPolicy);
			const spawned = await this.engineForQueue(this.queueForTask(taskName)).spawn(taskName, envelope, { queue: this.queueForTask(taskName), idempotencyKey: _TaskScopedIdempotencyKey(taskName, idempotencyKey), maxAttempts: retry.maximumAttempts, retryStrategy: retry.retryStrategy });
			return { taskId: spawned.taskID, taskName, idempotencyKey };
		}
		catch (error)
		{
			throw new AbsurdWorkflowError("spawn child task", error);
		}
	}

	/** Calls the fixed, parameterized Absurd procedure on the caller's existing transaction. */
	private async spawnWithTransaction<TInput>(transactionClient: unknown, task: IWorkflowTaskSpawn<TInput>, declaration: IWorkflowTaskDeclaration): Promise<IWorkflowTaskReceipt>
	{
		const taskName = _RequiredString("task.taskName", task.taskName);
		const idempotencyKey = _RequiredString("task.idempotencyKey", task.idempotencyKey);
		const retry = _AbsurdRetryPolicy(declaration.retryPolicy);
		const receipt = await new WorkflowTaskAdmission(this.queueForTask(taskName)).admit(transactionClient, { taskName, idempotencyKey, input: _EnvelopeForTask(idempotencyKey, task.input), ...retry });
		return { taskId: receipt.taskId, taskName, idempotencyKey };
	}

	/**
	 * Delivers an event to the queue that owns the waiting task.
	 *
	 * The event name includes the task identifier, so two tasks waiting for the same application
	 * event name cannot receive each other's payload.
	 */
	async emitEvent<TPayload>(task: IWorkflowTaskReceipt, event: IWorkflowTaskEvent<TPayload>): Promise<IWorkflowTaskEventReceipt>
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
	async cancel(task: IWorkflowTaskReceipt): Promise<IWorkflowTaskReceipt>
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
	async startWorkers(worker: IWorkflowWorkerStart): Promise<IWorkflowWorkers>
	{
		const workerName = _RequiredString("worker.workerName", worker.workerName);
		// 1. Reuse the existing group so repeated server start calls do not double dispatch work.
		const existing = this.workers.get(workerName);
		if (existing !== undefined)
		{
			return existing;
		}
		const queues = [...this.engines.entries()];
		const execution = this;
		return await ___DoWithTrace("workflow.worker.start", { workerName, queueCount: queues.length, workerConcurrency: this.options.workerConcurrency ?? 1 }, async function _StartWorkers(): Promise<IWorkflowWorkers>
		{
			try
			{
				// 2. Start one SDK worker per queue after all registrations created their clients.
				const workers = await Promise.all(queues.map(async ([queueName, engine]) => await engine.startWorker({ workerId: `${workerName}:${queueName}`, concurrency: execution.options.workerConcurrency, pollInterval: execution.options.pollIntervalMs === undefined ? undefined : execution.options.pollIntervalMs / 1000 })));
				// 3. Retain both SDK workers and the engine-neutral shutdown handle.
				execution.workerGroups.set(workerName, workers);
				const lifecycle: IWorkflowWorkers = {
					workerId: workerName,
					workerName,
					async drain(): Promise<void> { await execution.drainWorkers(workerName); },
					async stop(): Promise<void> { await execution.drainWorkers(workerName); },
				};
				execution.workers.set(workerName, lifecycle);
				execution.options.log?.info({ workerName, queueCount: queues.length, workerConcurrency: execution.options.workerConcurrency ?? 1 }, "workflow workers started");
				return lifecycle;
			}
			catch (error)
			{
				throw new AbsurdWorkflowError("start workers", error);
			}
		});
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
		const execution = this;
		await ___DoWithTrace("workflow.worker.drain", { workerName, workerCount: workers.length }, async function _DrainWorkers(): Promise<void>
		{
			try
			{
				// 1. Let every queue worker finish its accepted work before process resources disappear.
				await Promise.all(workers.map(async (worker) => await worker.close()));
				// 2. Forget the group after a successful drain so a failed close can be retried.
				execution.workerGroups.delete(workerName);
				execution.workers.delete(workerName);
				execution.options.log?.info({ workerName, workerCount: workers.length }, "workflow workers drained");
			}
			catch (error)
			{
				throw new AbsurdWorkflowError("drain workers", error);
			}
		});
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
		if (this.closePromise !== undefined)
		{
			return await this.closePromise;
		}
		const execution = this;
		const closing = ___DoWithTrace("workflow.runtime.close", { workerGroupCount: this.workerGroups.size, ownsDatabasePool: this.ownsDatabasePool }, async function _CloseRuntime(): Promise<void>
		{
			await Promise.all([...execution.workerGroups.keys()].map(async (workerName) => await execution.drainWorkers(workerName)));
			if (execution.ownsDatabasePool)
			{
				try
				{
					await execution.databasePool.end();
				}
				catch (error)
				{
					throw new AbsurdWorkflowError("close database pool", error);
				}
			}
			execution.options.log?.info({ workerGroupCount: 0, databasePoolClosed: execution.ownsDatabasePool }, "workflow runtime closed");
		});
		this.closePromise = closing;
		try
		{
			await closing;
		}
		catch (error)
		{
			if (this.closePromise === closing)
				this.closePromise = undefined;
			throw error;
		}
	}
}

/**
 * Creates the workflow and worker ports without exposing an Absurd SDK object to app composition.
 *
 * Called by: the OpenCrane server composition that registers product workflow tasks.
 */
export function _CreateAbsurdWorkflowEngine(options: IAbsurdWorkflowEngineOptions): IWorkflowEngine & IWorkflowWorkerRuntime
{
	return new AbsurdWorkflowEngine(options);
}
