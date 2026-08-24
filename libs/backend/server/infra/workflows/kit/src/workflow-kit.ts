import { createHash } from "node:crypto";

import { ___CreateLogger, ___DoWithTrace, ___GetActiveSpan, type Logger } from "@opencrane/backend/observability";
import { DurableExecutionError, DurableTaskCompensationError, DurableTaskRetryableError, DurableTaskTerminalError } from "@opencrane/backend/server/infra/workflows/contract";
import type { DurableCheckpointOperation, DurableCheckpointStep, DurableEventReceipt, DurableExecution, DurableExecutionTransaction, DurableTaskContext, DurableTaskDefinition, DurableTaskEvent, DurableTaskQueueAuthority, DurableTaskReceipt, DurableTaskSpawn } from "@opencrane/backend/server/infra/workflows/contract";

import { WorkflowTaskPolicyError } from "./workflow-kit.errors";
import { WorkflowStepOutcomes } from "./workflow-kit.types";
import type { IWorkflowKitOptions, IWorkflowTaskPolicy } from "./workflow-kit.types";
import { _AssertPersistableWorkflowPayload, _ParseWorkflowSiloTaskInput } from "./workflow-kit.validator";

/**
 * Normalizes an application failure before telemetry or engine state can retain its original text.
 *
 * Called by: `_WorkflowKit._RunCheckpoint`. A task error can include product data, so the kit keeps
 * its retry or compensation category while replacing the message with a safe operator summary.
 */
function _NormalizeStepError(error: unknown): DurableExecutionError
{
	if (error instanceof DurableTaskRetryableError)
	{
		return new DurableTaskRetryableError("Workflow checkpoint failed and may be retried.");
	}
	if (error instanceof DurableTaskCompensationError)
	{
		return new DurableTaskCompensationError("Workflow checkpoint failed and requires compensation.");
	}
	if (error instanceof DurableTaskTerminalError)
	{
		return new DurableTaskTerminalError("Workflow checkpoint failed.");
	}
	return new DurableTaskTerminalError("Workflow checkpoint failed.");
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

/** Hash an idempotency key before the kit uses it in telemetry. */
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
 * Builds the immutable queue authority shared by the workflow kit and engine adapter.
 *
 * Called by: application composition before it constructs the kit and engine adapter. Sharing the
 * same authority means a task cannot pass kit policy yet be dispatched to a different queue.
 */
export function __CreateWorkflowTaskQueueAuthority(taskPolicies: readonly IWorkflowTaskPolicy[]): DurableTaskQueueAuthority
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
 * Adds silo policy, payload validation, and safe checkpoint telemetry to a durable execution port.
 *
 * Called by: {@link __CreateWorkflowKit}. This wrapper holds no product behavior or state; it
 * guards the common handoff from a product workflow to the selected engine adapter.
 */
class _WorkflowKit implements DurableExecution
{
	/** Engine port whose durable state this kit protects. */
	private readonly execution: DurableExecution;
	/** Silo identity that every task input must carry. */
	private readonly siloId: string;
	/** Reviewed queue authority shared with the engine adapter. */
	private readonly queueAuthority: DurableTaskQueueAuthority;
	/** Structured logger that receives only fields safe for task diagnostics. */
	private readonly log: Logger;

	/** Bind one engine port to one silo and the queue authority selected by composition. */
	constructor(options: IWorkflowKitOptions)
	{
		this.execution = options.execution;
		this.siloId = _RequireNonBlankString(options.siloId);
		this.queueAuthority = options.queueAuthority;
		this.log = options.log ?? ___CreateLogger("workflows-kit");
	}

	/**
	 * Registers one silo-bound task and wraps each checkpoint with safe telemetry.
	 *
	 * Called by: workflow composition during server startup. Validation also runs on dispatch because
	 * the engine rehydrates saved input later, outside the original TypeScript call site.
	 */
	register<TInput, TResult>(definition: DurableTaskDefinition<TInput, TResult>): void
	{
		const policy = this._RequireTaskPolicy(definition.taskName);
		const workflowKit = this;
		this.execution.register({
			taskName: definition.taskName,
			async run(context: DurableTaskContext, input: TInput): Promise<TResult>
			{
				workflowKit._ValidateTaskInput(input);
				return await definition.run(new _WorkflowTaskContext(context, workflowKit, policy), input);
			},
		});
	}

	/** Admit a silo-bound task only after its payload and queue policy both pass. */
	async spawn<TInput>(transaction: DurableExecutionTransaction, task: DurableTaskSpawn<TInput>): Promise<DurableTaskReceipt>
	{
		this._ValidateTaskAdmission(task);
		return await this.execution.spawn(transaction, task);
	}

	/** Deliver an event only to a reviewed task and reject credential-shaped event payload fields. */
	async emitEvent<TPayload>(task: DurableTaskReceipt, event: DurableTaskEvent<TPayload>): Promise<DurableEventReceipt>
	{
		this._RequireTaskPolicy(task.taskName);
		_AssertPersistableWorkflowPayload(event.payload);
		return await this.execution.emitEvent(task, event);
	}

	/** Cancel a reviewed task without revealing its task identifier to logs or traces. */
	async cancel(task: DurableTaskReceipt): Promise<DurableTaskReceipt>
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
	async _RunCheckpoint<TResult>(task: DurableTaskReceipt, queue: string, step: DurableCheckpointStep, operation: DurableCheckpointOperation<TResult>): Promise<TResult>
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
					___GetActiveSpan()?.setAttributes({ outcome: WorkflowStepOutcomes.Failed, retryable: normalized instanceof DurableTaskRetryableError, durationMs: Math.round(performance.now() - startedAt) });
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
			const retryable = normalized instanceof DurableTaskRetryableError;
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
	_LogReplayedCheckpoint(task: DurableTaskReceipt, queue: string, step: DurableCheckpointStep, startedAt: number): void
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
	_ValidateTaskAdmission<TInput>(task: DurableTaskSpawn<TInput>): void
	{
		this._RequireTaskPolicy(task.taskName);
		_RequireNonBlankString(task.idempotencyKey);
		this._ValidateTaskInput(task.input);
	}
}

/** Adapt a contract task context so every checkpoint inherits the kit's policy and telemetry. */
class _WorkflowTaskContext implements DurableTaskContext
{
	/** Underlying engine-neutral context supplied for the current task dispatch. */
	private readonly context: DurableTaskContext;
	/** Kit that validates child tasks and records checkpoint telemetry. */
	private readonly kit: _WorkflowKit;
	/** Reviewed queue that owns the current task. */
	private readonly policy: IWorkflowTaskPolicy;
	/** Receipt for the task currently running. */
	readonly task: DurableTaskReceipt;

	/** Bind a current task context to its kit and reviewed queue policy. */
	constructor(context: DurableTaskContext, kit: _WorkflowKit, policy: IWorkflowTaskPolicy)
	{
		this.context = context;
		this.kit = kit;
		this.policy = policy;
		this.task = context.task;
	}

	/** Delegate one checkpoint through the payload-safe trace and structured-log wrapper. */
	async checkpoint<TResult>(step: DurableCheckpointStep, operation: DurableCheckpointOperation<TResult>): Promise<TResult>
	{
		const kit = this.kit;
		const task = this.task;
		const queue = this.policy.queue;
		let executed = false;
		const startedAt = performance.now();
		const result = await this.context.checkpoint(step, async function _TraceOperation(): Promise<TResult>
		{
			executed = true;
			return await kit._RunCheckpoint(task, queue, step, operation);
		});
		if (!executed)
		{
			kit._LogReplayedCheckpoint(task, queue, step, startedAt);
		}
		return result;
	}

	/** Receive an event after rejecting any credential-shaped fields from its durable payload. */
	async waitForEvent<TPayload>(eventName: string): Promise<DurableTaskEvent<TPayload>>
	{
		const event = await this.context.waitForEvent<TPayload>(eventName);
		_AssertPersistableWorkflowPayload(event.payload);
		return event;
	}

	/** Admit a child task only after it passes the same owning-silo and queue policy. */
	async spawnChild<TInput>(task: DurableTaskSpawn<TInput>): Promise<DurableTaskReceipt>
	{
		this.kit._ValidateTaskAdmission(task);
		return await this.context.spawnChild(task);
	}

	/** Await a child result through the engine-neutral context. */
	async awaitChild<TResult>(task: DurableTaskReceipt): Promise<TResult>
	{
		this.kit._RequireTaskPolicy(task.taskName);
		return await this.context.awaitChild<TResult>(task);
	}

	/** Suspend through the durable engine instead of keeping a timer in this process. */
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
export function __CreateWorkflowKit(options: IWorkflowKitOptions): DurableExecution
{
	return new _WorkflowKit(options);
}
