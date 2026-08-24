import { CancelledTask, SuspendTask, type TaskContext } from "absurd-sdk";

import { WorkflowError, WorkflowTaskCancelledError } from "@opencrane/backend/server/infra/workflows/contract";
import type { IWorkflowCheckpointOperation, IWorkflowCheckpointStep, IWorkflowTaskContext, IWorkflowTaskEvent, IWorkflowTaskReceipt, IWorkflowTaskSpawn } from "@opencrane/backend/server/infra/workflows/contract";

import type { AbsurdWorkflowEngine } from "./absurd-workflow-engine";
import { AbsurdWorkflowError } from "./absurd-workflow-error";

/** The terminal Absurd result states that this adapter maps to its engine-neutral contract. */
enum _AbsurdTaskResultStates
{
	/** The child handler returned a result that its parent may consume. */
	Completed = "completed",
	/** The engine cancelled the child before it produced a result. */
	Cancelled = "cancelled",
}

/** Reject an empty context name before it becomes a persisted engine identity. */
function _RequiredString(name: string, value: string): string
{
	if (value.trim().length === 0)
	{
		throw new WorkflowError(`${name} must be a non-empty string.`);
	}
	return value;
}

/** Keep one task's events out of every other task's event namespace. */
export function _AbsurdTaskEventName(taskId: string, eventName: string): string
{
	return `opencrane-task:${taskId}:event:${eventName}`;
}

/** Translate engine suspension and cancellation without swallowing the worker's suspend signal. */
function _NormalizeContextError(taskId: string, error: unknown): never
{
	if (error instanceof SuspendTask)
	{
		throw error;
	}
	if (error instanceof CancelledTask)
	{
		throw new WorkflowTaskCancelledError(taskId);
	}
	throw new AbsurdWorkflowError("task context operation", error);
}

/** Adapts one running Absurd task to the replay-safe workflow-task context. */
export class _AbsurdTaskContext implements IWorkflowTaskContext
{
	/** Engine context that persists checkpoints and task waits. */
	private readonly context: TaskContext;
	/** Registered task receipt supplied to the domain handler. */
	readonly task: IWorkflowTaskReceipt;
	/** Positive attempt number read from Absurd's claimed task. */
	readonly attempt: number;
	/** Child-task admissions require the adapter's engine and queue policy. */
	private readonly execution: AbsurdWorkflowEngine;

	/** Creates a contract context around one Absurd worker invocation. */
	constructor(context: TaskContext, task: IWorkflowTaskReceipt, attempt: number, execution: AbsurdWorkflowEngine)
	{
		this.context = context;
		this.task = task;
		this.attempt = attempt;
		this.execution = execution;
	}

	/** Persist or replay one named operation result. */
	async checkpoint<TResult>(step: IWorkflowCheckpointStep, operation: IWorkflowCheckpointOperation<TResult>): Promise<TResult>
	{
		const stepName = _RequiredString("step.stepName", step.stepName);
		try
		{
			return await this.context.step(stepName, operation);
		}
		catch (error)
		{
			if (error instanceof CancelledTask)
			{
				return _NormalizeContextError(this.task.taskId, error);
			}
			throw error;
		}
	}

	/** Suspend durably until this task receives its private event name. */
	async waitForEvent<TPayload>(eventName: string): Promise<IWorkflowTaskEvent<TPayload>>
	{
		const acceptedName = _RequiredString("eventName", eventName);
		try
		{
			const payload = await this.context.awaitEvent(_AbsurdTaskEventName(this.task.taskId, acceptedName));
			return { eventName: acceptedName, payload: payload as unknown as TPayload };
		}
		catch (error)
		{
			return _NormalizeContextError(this.task.taskId, error);
		}
	}

	/** Spawn a child through the engine API while retaining its deterministic key. */
	async spawnChild<TInput>(task: IWorkflowTaskSpawn<TInput>): Promise<IWorkflowTaskReceipt>
	{
		return await this.execution.spawnFromTask(task);
	}

	/**
	 * Await a child result only across queues, which is the Absurd 0.5.0 behavior Gate D1 admitted.
	 * @see https://github.com/elewa-git/opencrane/issues/695 — Gate D1 records child spawn and await across queues.
	 */
	async awaitChild<TResult>(task: IWorkflowTaskReceipt): Promise<TResult>
	{
		const childQueue = this.execution.queueForTask(task.taskName);
		const parentQueue = this.execution.queueForTask(this.task.taskName);
		if (childQueue === parentQueue)
		{
			throw new WorkflowError(`Child task ${task.taskId} must use a different Absurd queue from parent task ${this.task.taskId}.`);
		}
		try
		{
			const result = await this.context.awaitTaskResult(task.taskId, { queue: childQueue });
			if (result.state === _AbsurdTaskResultStates.Completed)
			{
				return result.result as unknown as TResult;
			}
			if (result.state === _AbsurdTaskResultStates.Cancelled)
			{
				throw new WorkflowTaskCancelledError(task.taskId);
			}
			throw new WorkflowError(`Child task ${task.taskId} finished without a result.`);
		}
		catch (error)
		{
			if (error instanceof WorkflowError)
			{
				throw error;
			}
			return _NormalizeContextError(this.task.taskId, error);
		}
	}

	/** Suspend at an engine-persisted instant without retaining a process timer. */
	async sleepUntil(instant: Date): Promise<void>
	{
		if (!(instant instanceof Date) || Number.isNaN(instant.getTime()))
		{
			throw new WorkflowError("sleepUntil requires a valid Date.");
		}
		try
		{
			await this.context.sleepUntil("opencrane:sleep-until", instant);
		}
		catch (error)
		{
			return _NormalizeContextError(this.task.taskId, error);
		}
	}
}
