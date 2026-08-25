import { createHash } from "node:crypto";

import { ___CreateLogger, ___DoWithTrace, ___GetActiveSpan, type Logger } from "@opencrane/backend/observability";
import { WorkflowError, WorkflowTaskRetryableError, WorkflowTaskTerminalError } from "@opencrane/backend/server/infra/workflows/contract";
import type { IWorkflowCheckpointOperation, IWorkflowCheckpointStep, IWorkflowEngine, IWorkflowTaskContext, IWorkflowTaskDeclaration, IWorkflowTaskDefinition, IWorkflowTaskEvent, IWorkflowTaskEventReceipt, IWorkflowTaskQueueAuthority, IWorkflowTaskReceipt, IWorkflowTaskSpawn, IWorkflowTransaction } from "@opencrane/backend/server/infra/workflows/contract";

import { WorkflowTaskPolicyError } from "./workflow-guard.errors";
import { WorkflowStepOutcomes } from "./workflow-guard.types";
import type { IWorkflowGuardOptions, IWorkflowTaskPolicy } from "./workflow-guard.types";
import { _AssertPersistableWorkflowPayload, _ParseWorkflowSiloTaskInput } from "./workflow-guard.validator";

/**
 * Normalizes an application failure before telemetry or engine state can retain its original text.
 *
 * Called by: `WorkflowGuard._RunCheckpoint`. A task error can include product data, so the guard keeps
 * its retry category while replacing the message with a safe operator summary.
 */
function _NormalizeStepError(error: unknown): WorkflowError
{
	if (error instanceof WorkflowTaskRetryableError)
	{
		return new WorkflowTaskRetryableError("Workflow checkpoint failed and may be retried.");
	}
	if (error instanceof WorkflowTaskTerminalError)
	{
		return new WorkflowTaskTerminalError("Workflow checkpoint failed.");
	}
	return new WorkflowTaskTerminalError("Workflow checkpoint failed.");
}

/** Require non-blank configuration text before it can select a task, silo, queue, or checkpoint. */
function _RequireNonBlankString(value: string): string
{
	if (value.trim().length === 0)
	{
		throw new WorkflowTaskPolicyError();
	}
	return value;
}

/** Hash an idempotency key before the guard uses it in telemetry. */
function _DigestTaskKey(taskKey: string): string
{
	return createHash("sha256").update(taskKey).digest("hex");
}

/** Build the queue lookup that one reviewed task authority will own. */
function _CreateTaskQueueMap(taskPolicies: readonly IWorkflowTaskPolicy[]): Readonly<Record<string, string>>
{
	const queues: Record<string, string> = {};
	for (const policy of taskPolicies)
	{
		const taskName = _RequireNonBlankString(policy.taskName);
		const queue = _RequireNonBlankString(policy.queue);
		if (queues[taskName] !== undefined)
		{
			throw new WorkflowTaskPolicyError();
		}
		queues[taskName] = queue;
	}
	return Object.freeze(queues);
}

/**
 * Builds the immutable queue authority shared by the workflow guard and engine adapter.
 *
 * Called by: application composition before it constructs the guard and engine adapter. Sharing the
 * same authority means a task cannot pass guard policy yet be dispatched to a different queue.
 */
export function __CreateWorkflowTaskQueueAuthority(taskPolicies: readonly IWorkflowTaskPolicy[]): IWorkflowTaskQueueAuthority
{
	const queues = _CreateTaskQueueMap(taskPolicies);
	return Object.freeze({
		queueForTask(taskName: string): string
		{
			const queue = queues[_RequireNonBlankString(taskName)];
			if (queue === undefined)
			{
				throw new WorkflowTaskPolicyError();
			}
			return queue;
		},
	});
}

/**
 * Adds silo policy, payload validation, and safe checkpoint telemetry to a workflow engine.
 *
 * Called by: {@link __CreateWorkflowGuard}. This wrapper holds no product behavior or state; it
 * guards the common handoff from a product workflow to the selected engine adapter.
 */
class WorkflowGuard implements IWorkflowEngine
{
	/** Engine port whose saved state this guard protects. */
	private readonly execution: IWorkflowEngine;
	/** Silo identity that every task input must carry. */
	private readonly siloId: string;
	/** Reviewed queue authority shared with the engine adapter. */
	private readonly queueAuthority: IWorkflowTaskQueueAuthority;
	/** Structured logger that receives only fields safe for task diagnostics. */
	private readonly log: Logger;

	/** Bind one engine port to one silo and the queue authority selected by composition. */
	constructor(options: IWorkflowGuardOptions)
	{
		this.execution = options.execution;
		this.siloId = _RequireNonBlankString(options.siloId);
		this.queueAuthority = options.queueAuthority;
		this.log = options.log ?? ___CreateLogger("workflow-guard");
	}

	/** Declare a reviewed task for transaction-bound admission without installing a local handler. */
	declare(declaration: IWorkflowTaskDeclaration): void
	{
		this._RequireTaskPolicy(declaration.taskName);
		this.execution.declare(declaration);
	}

	/**
	 * Registers one silo-bound task and wraps each checkpoint with safe telemetry.
	 *
	 * Called by: workflow composition during server startup. Validation also runs on dispatch because
	 * the engine rehydrates saved input later, outside the original TypeScript call site.
	 */
	register<TInput, TResult>(definition: IWorkflowTaskDefinition<TInput, TResult>): void
	{
		const policy = this._RequireTaskPolicy(definition.taskName);
		const workflowGuard = this;
		this.execution.register({
			taskName: definition.taskName,
			retryPolicy: definition.retryPolicy,
			async run(context: IWorkflowTaskContext, input: TInput): Promise<TResult>
			{
				workflowGuard._ValidateTaskInput(input);
				return await definition.run(new _WorkflowTaskContext(context, workflowGuard, policy), input);
			},
		});
	}

	/** Admit a silo-bound task only after its payload and queue policy both pass. */
	async spawn<TInput>(transaction: IWorkflowTransaction, task: IWorkflowTaskSpawn<TInput>): Promise<IWorkflowTaskReceipt>
	{
		this._ValidateTaskAdmission(task);
		return await this.execution.spawn(transaction, task);
	}

	/** Deliver an event only to a reviewed task and reject credential-shaped event payload fields. */
	async emitEvent<TPayload>(task: IWorkflowTaskReceipt, event: IWorkflowTaskEvent<TPayload>): Promise<IWorkflowTaskEventReceipt>
	{
		this._RequireTaskPolicy(task.taskName);
		_AssertPersistableWorkflowPayload(event.payload);
		return await this.execution.emitEvent(task, event);
	}

	/** Cancel a reviewed task without revealing its task identifier to logs or traces. */
	async cancel(task: IWorkflowTaskReceipt): Promise<IWorkflowTaskReceipt>
	{
		this._RequireTaskPolicy(task.taskName);
		return await this.execution.cancel(task);
	}

	/**
	 * Executes one checkpoint with trace fields that cannot contain task input.
	 *
	 * Called by: `_WorkflowTaskContext.checkpoint`. The wrapper reports whether an operation ran,
	 * replayed, or failed without recording its input, result, or original error message.
	 */
	async _RunCheckpoint<TResult>(task: IWorkflowTaskReceipt, queue: string, step: IWorkflowCheckpointStep, operation: IWorkflowCheckpointOperation<TResult>): Promise<TResult>
	{
		// 1. Keep the diagnostic shape small so structured logs cannot receive task payloads.
		const stepName = _RequireNonBlankString(step.stepName);
		const safeFields = { taskName: task.taskName, stepName, siloId: this.siloId, queue, taskKeyDigest: _DigestTaskKey(task.idempotencyKey) };
		const startedAt = performance.now();
		this.log.debug(safeFields, "workflow checkpoint started");
		try
		{
			// 2. Associate only safe fields with the tracing span around new checkpoint work.
			const result = await ___DoWithTrace("workflow.step.execute", safeFields, async function _RunCheckpoint(): Promise<TResult>
			{
				try
				{
					const result = await operation();
					___GetActiveSpan()?.setAttributes({ outcome: WorkflowStepOutcomes.Completed, retryable: false, durationMs: Math.round(performance.now() - startedAt) });
					return result;
				}
				catch (error)
				{
					const normalized = _NormalizeStepError(error);
					___GetActiveSpan()?.setAttributes({ outcome: WorkflowStepOutcomes.Failed, retryable: normalized instanceof WorkflowTaskRetryableError, durationMs: Math.round(performance.now() - startedAt) });
					throw normalized;
				}
			});
			const durationMs = Math.round(performance.now() - startedAt);
			this.log.debug({ ...safeFields, outcome: WorkflowStepOutcomes.Completed, retryable: false, durationMs }, "workflow checkpoint completed");
			return result;
		}
		catch (error)
		{
			// 3. Preserve the engine's retry category but remove task-provided error text before logging.
			const normalized = _NormalizeStepError(error);
			const retryable = normalized instanceof WorkflowTaskRetryableError;
			const durationMs = Math.round(performance.now() - startedAt);
			if (retryable)
			{
				this.log.warn({ ...safeFields, outcome: WorkflowStepOutcomes.Failed, retryable, durationMs, err: normalized }, "workflow checkpoint may be retried");
			}
			else
			{
				this.log.error({ ...safeFields, outcome: WorkflowStepOutcomes.Failed, retryable, durationMs, err: normalized }, "workflow checkpoint failed");
			}
			throw normalized;
		}
	}

	/** Log a replayed checkpoint without starting a span for an operation that did not run. */
	_LogReplayedCheckpoint(task: IWorkflowTaskReceipt, queue: string, step: IWorkflowCheckpointStep, startedAt: number): void
	{
		const stepName = _RequireNonBlankString(step.stepName);
		this.log.debug({ taskName: task.taskName, stepName, siloId: this.siloId, queue, taskKeyDigest: _DigestTaskKey(task.idempotencyKey), outcome: WorkflowStepOutcomes.Replayed, retryable: false, durationMs: Math.round(performance.now() - startedAt) }, "workflow checkpoint replayed");
	}

	/** Reject an unreviewed task name before it reaches an engine queue. */
	_RequireTaskPolicy(taskName: string): IWorkflowTaskPolicy
	{
		const acceptedTaskName = _RequireNonBlankString(taskName);
		try
		{
			return { taskName: acceptedTaskName, queue: _RequireNonBlankString(this.queueAuthority.queueForTask(acceptedTaskName)) };
		}
		catch
		{
			throw new WorkflowTaskPolicyError();
		}
	}

	/** Validate generic task input before dispatching it to a silo-bound workflow handler. */
	_ValidateTaskInput(input: unknown): void
	{
		const validatedInput = _ParseWorkflowSiloTaskInput(input);
		if (validatedInput.siloId !== this.siloId)
		{
			throw new WorkflowTaskPolicyError();
		}
	}

	/** Validate a task command before admission or child-task creation can persist it. */
	_ValidateTaskAdmission<TInput>(task: IWorkflowTaskSpawn<TInput>): void
	{
		this._RequireTaskPolicy(task.taskName);
		_RequireNonBlankString(task.idempotencyKey);
		this._ValidateTaskInput(task.input);
	}
}

/** Adapts a workflow worker so every checkpoint inherits the guard's policy and telemetry. */
class _WorkflowTaskContext implements IWorkflowTaskContext
{
	/** Underlying engine-neutral context supplied for the current task dispatch. */
	private readonly context: IWorkflowTaskContext;
	/** Guard that validates child tasks and records checkpoint telemetry. */
	private readonly guard: WorkflowGuard;
	/** Reviewed queue that owns the current task. */
	private readonly policy: IWorkflowTaskPolicy;
	/** Receipt for the task currently running. */
	readonly task: IWorkflowTaskReceipt;
	/** Engine attempt number for the current handler run. */
	readonly attempt: number;

	/** Bind a current task context to its guard and reviewed queue policy. */
	constructor(context: IWorkflowTaskContext, guard: WorkflowGuard, policy: IWorkflowTaskPolicy)
	{
		this.context = context;
		this.guard = guard;
		this.policy = policy;
		this.task = context.task;
		this.attempt = context.attempt;
	}

	/** Delegate one checkpoint through the payload-safe trace and structured-log wrapper. */
	async checkpoint<TResult>(step: IWorkflowCheckpointStep, operation: IWorkflowCheckpointOperation<TResult>): Promise<TResult>
	{
		const guard = this.guard;
		const task = this.task;
		const queue = this.policy.queue;
		let executed = false;
		const startedAt = performance.now();
		const result = await this.context.checkpoint(step, async function _TraceOperation(): Promise<TResult>
		{
			executed = true;
			return await guard._RunCheckpoint(task, queue, step, operation);
		});
		if (!executed)
		{
			guard._LogReplayedCheckpoint(task, queue, step, startedAt);
		}
		return result;
	}

	/** Receives an event after rejecting any credential-shaped fields from its saved payload. */
	async waitForEvent<TPayload>(eventName: string): Promise<IWorkflowTaskEvent<TPayload>>
	{
		const event = await this.context.waitForEvent<TPayload>(eventName);
		_AssertPersistableWorkflowPayload(event.payload);
		return event;
	}

	/** Admit a child task only after it passes the same owning-silo and queue policy. */
	async spawnChild<TInput>(task: IWorkflowTaskSpawn<TInput>): Promise<IWorkflowTaskReceipt>
	{
		this.guard._ValidateTaskAdmission(task);
		return await this.context.spawnChild(task);
	}

	/** Await a child result through the engine-neutral context. */
	async awaitChild<TResult>(task: IWorkflowTaskReceipt): Promise<TResult>
	{
		this.guard._RequireTaskPolicy(task.taskName);
		return await this.context.awaitChild<TResult>(task);
	}

	/** Suspends through the workflow engine instead of keeping a timer in this process. */
	async sleepUntil(instant: Date): Promise<void>
	{
		await this.context.sleepUntil(instant);
	}
}

/**
 * Creates the policy-enforcing workflow boundary around one execution adapter.
 *
 * Called by: server composition. The returned contract deliberately exposes only registration,
 * task admission, event delivery, and cancellation; engine workers remain a composition concern.
 */
export function __CreateWorkflowGuard(options: IWorkflowGuardOptions): IWorkflowEngine
{
	return new WorkflowGuard(options);
}
