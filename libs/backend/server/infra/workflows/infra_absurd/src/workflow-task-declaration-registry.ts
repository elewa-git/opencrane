import { WorkflowError, WorkflowTaskRetryBackoffKinds } from "@opencrane/backend/server/infra/workflows/contract";
import type { IWorkflowTaskDeclaration, IWorkflowTaskQueueAuthority, IWorkflowTaskRetryPolicy } from "@opencrane/backend/server/infra/workflows/contract";

/** Reject an empty task or queue name before the registry retains its declaration. */
function _requiredString(name: string, value: string): string
{
	if (value.trim().length === 0)
	{
		throw new WorkflowError(`${name} must be a non-empty string.`);
	}
	return value;
}

/** Compare normalized retry policies by their values instead of their property order. */
function _sameRetryPolicy(left: IWorkflowTaskRetryPolicy, right: IWorkflowTaskRetryPolicy): boolean
{
	return left.maximumAttempts === right.maximumAttempts && left.backoff.kind === right.backoff.kind && left.backoff.initialDelaySeconds === right.backoff.initialDelaySeconds && left.backoff.multiplier === right.backoff.multiplier && left.backoff.maximumDelaySeconds === right.backoff.maximumDelaySeconds;
}

/**
 * Validates a task retry policy and supplies the no-retry default used for persisted admission.
 *
 * Called by: {@link _WorkflowTaskDeclarationRegistry} before it stores a declaration, and the
 * Absurd adapter when it maps that policy to the SDK request.
 * @param policy - Optional engine-neutral retry policy supplied by task composition.
 * @returns The validated policy, or the one-attempt default when none was supplied.
 * @throws WorkflowError when an attempt or delay value is outside the supported range.
 */
export function _NormalizeWorkflowTaskRetryPolicy(policy: IWorkflowTaskRetryPolicy | undefined): IWorkflowTaskRetryPolicy
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

/**
 * Stores the task declarations that permit transaction-bound workflow admission.
 *
 * The registry validates the task's reviewed queue before it writes the declaration and refuses a
 * retry-policy change for a name already in use. It owns no SDK handler or task execution state;
 * the Absurd adapter keeps those responsibilities.
 *
 * Called by: `AbsurdWorkflowEngine`, once for every remote declaration or local registration.
 */
export class _WorkflowTaskDeclarationRegistry
{
	/** Stores declarations by the task name used for admission. */
	private readonly declarations = new Map<string, IWorkflowTaskDeclaration>();
	/** Resolves the reviewed queue policy shared with the workflow guard. */
	private readonly queueAuthority: IWorkflowTaskQueueAuthority;

	/** Binds the registry to the queue authority selected by application composition. */
	constructor(queueAuthority: IWorkflowTaskQueueAuthority)
	{
		this.queueAuthority = queueAuthority;
	}

	/**
	 * Validate and retain one declaration without installing an SDK handler.
	 * @param declaration - Task name and retry policy allowed into transactional admission.
	 * @throws WorkflowError when the name, retry policy, or reviewed queue is invalid or conflicts.
	 */
	declare(declaration: IWorkflowTaskDeclaration): void
	{
		// 1. Validate the name and retry policy before either becomes admission state.
		const taskName = _requiredString("declaration.taskName", declaration.taskName);
		const retryPolicy = _NormalizeWorkflowTaskRetryPolicy(declaration.retryPolicy);
		// 2. Reject a declaration that would change the retry behavior already selected for this task.
		const existing = this.declarations.get(taskName);
		if (existing !== undefined && !_sameRetryPolicy(_NormalizeWorkflowTaskRetryPolicy(existing.retryPolicy), retryPolicy))
		{
			throw new WorkflowError(`Workflow task ${taskName} has a different declaration.`);
		}
		// 3. Validate the reviewed queue before retaining the normalized declaration.
		_requiredString("queue", this.queueAuthority.queueForTask(taskName));
		this.declarations.set(taskName, { taskName, retryPolicy });
	}

	/** Return the declaration that permits this task name, or undefined when none was reviewed. */
	find(taskName: string): IWorkflowTaskDeclaration | undefined
	{
		return this.declarations.get(taskName);
	}
}
