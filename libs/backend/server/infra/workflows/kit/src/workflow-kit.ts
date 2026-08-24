import { createHash } from "node:crypto";

import { ___CreateLogger, ___DoWithTrace, ___GetActiveSpan } from "@opencrane/backend/observability";
import { DurableExecutionError, DurableTaskRetryableError, DurableTaskTerminalError } from "@opencrane/backend/server/infra/workflows/contract";
import type { DurableCheckpointOperation, DurableCheckpointStep, DurableEventReceipt, DurableExecution, DurableExecutionTransaction, DurableTaskContext, DurableTaskDefinition, DurableTaskEvent, DurableTaskQueueAuthority, DurableTaskReceipt, DurableTaskSpawn } from "@opencrane/backend/server/infra/workflows/contract";

import { WorkflowStepOutcomes } from "./workflow-kit.types";
import type { WorkflowKitOptions, WorkflowSiloTaskInput, WorkflowTaskPolicy } from "./workflow-kit.types";

/** Reject a value that cannot safely become a durable task or event payload. */
export class WorkflowPayloadFirewallError extends DurableExecutionError
{
	/** Create a payload rejection without echoing the rejected value or field name. */
	constructor()
	{
		super("Workflow payload violates the durable execution boundary.");
		this.name = "WorkflowPayloadFirewallError";
	}
}

/** Report a task-policy violation without exposing internal queue configuration. */
export class WorkflowTaskPolicyError extends DurableExecutionError
{
	/** Create a task-policy rejection with an operator-safe message. */
	constructor()
	{
		super("Workflow task is not admitted by this silo policy.");
		this.name = "WorkflowTaskPolicyError";
	}
}

/** Normalize an application failure before a trace or log can retain its original message. */
function _NormalizedStepError(error: unknown): DurableExecutionError
{
	if (error instanceof DurableTaskRetryableError)
	{
		return new DurableTaskRetryableError("Workflow checkpoint failed and may be retried.");
	}
	if (error instanceof DurableTaskTerminalError)
	{
		return new DurableTaskTerminalError("Workflow checkpoint failed.");
	}
	return new DurableTaskTerminalError("Workflow checkpoint failed.");
}

/** Reject blank configuration strings before they can select a different silo or queue. */
function _RequiredString(value: string): string
{
	if (value.trim().length === 0)
	{
		throw new WorkflowTaskPolicyError();
	}
	return value;
}

/** Return whether a payload property name can reasonably carry a credential. */
function _IsCredentialShapedField(name: string): boolean
{
	const normalized = name.replaceAll("_", "").replaceAll("-", "").toLowerCase();
	return normalized === "password"
		|| normalized === "passwd"
		|| normalized === "secret"
		|| normalized === "token"
		|| normalized === "credential"
		|| normalized === "authorization"
		|| normalized === "apikey"
		|| normalized === "privatekey"
		|| normalized === "accesskey"
		|| normalized === "connectionstring"
		|| normalized === "databaseurl"
		|| normalized === "bearer"
		|| normalized === "cookie"
		|| normalized.endsWith("token")
		|| normalized.endsWith("secret")
		|| normalized.endsWith("credential")
		|| normalized.endsWith("credentials");
}

/** Reject credential-shaped fields, non-JSON values, and cycles before durable persistence. */
function _AssertPayloadIsAllowed(value: unknown, seen: WeakSet<object> = new WeakSet<object>()): void
{
	if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number")
	{
		return;
	}
	if (typeof value === "bigint" || typeof value === "function" || typeof value === "symbol" || typeof value !== "object")
	{
		throw new WorkflowPayloadFirewallError();
	}
	if (seen.has(value))
	{
		throw new WorkflowPayloadFirewallError();
	}
	seen.add(value);
	if (Array.isArray(value))
	{
		for (const item of value)
		{
			_AssertPayloadIsAllowed(item, seen);
		}
		return;
	}
	if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
	{
		throw new WorkflowPayloadFirewallError();
	}
	for (const [name, item] of Object.entries(value))
	{
		if (_IsCredentialShapedField(name))
		{
			throw new WorkflowPayloadFirewallError();
		}
		_AssertPayloadIsAllowed(item, seen);
	}
}

/** Digest an idempotency key before it crosses the telemetry boundary. */
export function __WorkflowTaskKeyDigest(taskKey: string): string
{
	return createHash("sha256").update(taskKey).digest("hex");
}

/** Build the engine queue map from reviewed task policy without exposing raw task payloads. */
export function __WorkflowTaskQueueMap(taskPolicies: readonly WorkflowTaskPolicy[]): Readonly<Record<string, string>>
{
	const queues: Record<string, string> = {};
	for (const policy of taskPolicies)
	{
		const taskName = _RequiredString(policy.taskName);
		const queue = _RequiredString(policy.queue);
		if (queues[taskName] !== undefined)
		{
			throw new WorkflowTaskPolicyError();
		}
		queues[taskName] = queue;
	}
	return Object.freeze(queues);
}

/** Build the one immutable queue authority shared by the workflow kit and engine adapter. */
export function __CreateWorkflowTaskQueueAuthority(taskPolicies: readonly WorkflowTaskPolicy[]): DurableTaskQueueAuthority
{
	const queues = __WorkflowTaskQueueMap(taskPolicies);
	return Object.freeze({
		queueForTask(taskName: string): string
		{
			const queue = queues[_RequiredString(taskName)];
			if (queue === undefined)
			{
				throw new WorkflowTaskPolicyError();
			}
			return queue;
		},
	});
}

/** Add silo policy, payload firewalls, and payload-safe step telemetry to durable execution. */
export class __WorkflowKit implements DurableExecution
{
	/** Engine port whose durable state this kit protects. */
	private readonly execution: DurableExecution;
	/** Silo identity that every task input must carry. */
	private readonly siloId: string;
	/** Reviewed queue authority shared with the engine adapter. */
	private readonly queueAuthority: DurableTaskQueueAuthority;
	/** Structured logger that receives only fields safe for task diagnostics. */
	private readonly log;

	/** Bind one engine port to one silo and the queue authority selected by composition. */
	constructor(options: WorkflowKitOptions)
	{
		this.execution = options.execution;
		this.siloId = _RequiredString(options.siloId);
		this.queueAuthority = options.queueAuthority;
		this.log = options.log ?? ___CreateLogger("workflows-kit");
	}

	/** Register one silo-bound task and wrap each of its checkpoints with safe telemetry. */
	register<TInput, TResult>(definition: DurableTaskDefinition<TInput, TResult>): void
	{
		const policy = this._PolicyFor(definition.taskName);
		const kit = this;
		this.execution.register({
			taskName: definition.taskName,
			retryPolicy: definition.retryPolicy,
			async run(context: DurableTaskContext, input: TInput): Promise<TResult>
			{
				kit._AssertSiloInput(input as unknown as WorkflowSiloTaskInput);
				return await definition.run(new _WorkflowTaskContext(context, kit, policy), input);
			},
		});
	}

	/** Admit a silo-bound task only after its payload and queue policy both pass. */
	async spawn<TInput>(transaction: DurableExecutionTransaction, task: DurableTaskSpawn<TInput>): Promise<DurableTaskReceipt>
	{
		this._AssertTask(task);
		return await this.execution.spawn(transaction, task);
	}

	/** Deliver an event only to a reviewed task and reject credential-shaped event payload fields. */
	async emitEvent<TPayload>(task: DurableTaskReceipt, event: DurableTaskEvent<TPayload>): Promise<DurableEventReceipt>
	{
		this._PolicyFor(task.taskName);
		_AssertPayloadIsAllowed(event.payload);
		return await this.execution.emitEvent(task, event);
	}

	/** Cancel a reviewed task without revealing its task identifier to logs or traces. */
	async cancel(task: DurableTaskReceipt): Promise<DurableTaskReceipt>
	{
		this._PolicyFor(task.taskName);
		return await this.execution.cancel(task);
	}

	/** Execute a named checkpoint operation with trace fields that cannot contain task input. */
	async _Checkpoint<TResult>(task: DurableTaskReceipt, queue: string, step: DurableCheckpointStep, operation: DurableCheckpointOperation<TResult>): Promise<TResult>
	{
		const stepName = _RequiredString(step.stepName);
		const safeFields = { taskName: task.taskName, stepName, siloId: this.siloId, queue, taskKeyDigest: __WorkflowTaskKeyDigest(task.idempotencyKey) };
		const startedAt = performance.now();
		this.log.debug(safeFields, "workflow checkpoint started");
		try
		{
			const result = await ___DoWithTrace("workflow.step.execute", safeFields, async function _RunCheckpoint(): Promise<TResult>
			{
				try
				{
					const result = await operation();
					___GetActiveSpan()?.setAttributes({ outcome: WorkflowStepOutcomes.Completed, retryable: false, durationMs: Math.round(performance.now() - startedAt) });
					return result;
				}
				catch (error: unknown)
				{
					const normalized = _NormalizedStepError(error);
					___GetActiveSpan()?.setAttributes({ outcome: WorkflowStepOutcomes.Failed, retryable: normalized instanceof DurableTaskRetryableError, durationMs: Math.round(performance.now() - startedAt) });
					throw normalized;
				}
			});
			const durationMs = Math.round(performance.now() - startedAt);
			this.log.debug({ ...safeFields, outcome: WorkflowStepOutcomes.Completed, retryable: false, durationMs }, "workflow checkpoint completed");
			return result;
		}
		catch (error: unknown)
		{
			const normalized = _NormalizedStepError(error);
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

	/** Record a replayed checkpoint without starting a span for an operation that did not run. */
	_ReplayedCheckpoint(task: DurableTaskReceipt, queue: string, step: DurableCheckpointStep, startedAt: number): void
	{
		const stepName = _RequiredString(step.stepName);
		this.log.debug({ taskName: task.taskName, stepName, siloId: this.siloId, queue, taskKeyDigest: __WorkflowTaskKeyDigest(task.idempotencyKey), outcome: WorkflowStepOutcomes.Replayed, retryable: false, durationMs: Math.round(performance.now() - startedAt) }, "workflow checkpoint replayed");
	}

	/** Reject an unreviewed task name before it reaches an engine queue. */
	_PolicyFor(taskName: string): WorkflowTaskPolicy
	{
		const acceptedTaskName = _RequiredString(taskName);
		try
		{
			return { taskName: acceptedTaskName, queue: _RequiredString(this.queueAuthority.queueForTask(acceptedTaskName)) };
		}
		catch
		{
			throw new WorkflowTaskPolicyError();
		}
	}

	/** Reject task admission when the input is not JSON-shaped or belongs to another silo. */
	_AssertSiloInput(input: WorkflowSiloTaskInput): void
	{
		if (typeof input !== "object" || input === null || !("siloId" in input))
		{
			throw new WorkflowPayloadFirewallError();
		}
		_AssertPayloadIsAllowed(input);
		if (input.siloId !== this.siloId)
		{
			throw new WorkflowTaskPolicyError();
		}
	}

	/** Validate a task command before task admission or a child-task context can persist it. */
	_AssertTask<TInput>(task: DurableTaskSpawn<TInput>): void
	{
		this._PolicyFor(task.taskName);
		_RequiredString(task.idempotencyKey);
		this._AssertSiloInput(task.input as WorkflowSiloTaskInput);
	}
}

/** Adapt a contract task context so every checkpoint inherits the kit's policy and telemetry. */
class _WorkflowTaskContext implements DurableTaskContext
{
	/** Underlying engine-neutral context supplied for the current task dispatch. */
	private readonly context: DurableTaskContext;
	/** Kit that validates child tasks and records checkpoint telemetry. */
	private readonly kit: __WorkflowKit;
	/** Reviewed queue that owns the current task. */
	private readonly policy: WorkflowTaskPolicy;
	/** Receipt for the task currently running. */
	readonly task: DurableTaskReceipt;
	/** Engine attempt number for the current handler run. */
	readonly attempt: number;

	/** Bind a current task context to its kit and reviewed queue policy. */
	constructor(context: DurableTaskContext, kit: __WorkflowKit, policy: WorkflowTaskPolicy)
	{
		this.context = context;
		this.kit = kit;
		this.policy = policy;
		this.task = context.task;
		this.attempt = context.attempt;
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
			return await kit._Checkpoint(task, queue, step, operation);
		});
		if (!executed)
		{
			kit._ReplayedCheckpoint(task, queue, step, startedAt);
		}
		return result;
	}

	/** Receive an event after rejecting any credential-shaped fields from its durable payload. */
	async waitForEvent<TPayload>(eventName: string): Promise<DurableTaskEvent<TPayload>>
	{
		const event = await this.context.waitForEvent<TPayload>(eventName);
		_AssertPayloadIsAllowed(event.payload);
		return event;
	}

	/** Admit a child task only after it passes the same owning-silo and queue policy. */
	async spawnChild<TInput>(task: DurableTaskSpawn<TInput>): Promise<DurableTaskReceipt>
	{
		this.kit._AssertTask(task);
		return await this.context.spawnChild(task);
	}

	/** Await a child result through the engine-neutral context. */
	async awaitChild<TResult>(task: DurableTaskReceipt): Promise<TResult>
	{
		this.kit._PolicyFor(task.taskName);
		return await this.context.awaitChild<TResult>(task);
	}

	/** Suspend through the durable engine instead of keeping a timer in this process. */
	async sleepUntil(instant: Date): Promise<void>
	{
		await this.context.sleepUntil(instant);
	}
}

/** Create a policy-enforcing kit around one durable execution adapter. */
export function __CreateWorkflowKit(options: WorkflowKitOptions): DurableExecution
{
	return new __WorkflowKit(options);
}
