import { __HaveSameWorkflowTaskRetryPolicy, __NormalizeWorkflowTaskDeclaration, WorkflowError } from "@opencrane/backend/server/infra/workflows/contract";
import type { IWorkflowTaskDeclaration, IWorkflowTaskQueueAuthority } from "@opencrane/backend/server/infra/workflows/contract";

/** Reject an empty task or queue name before the registry retains its declaration. */
function _requiredString(name: string, value: string): string
{
	if (value.trim().length === 0)
	{
		throw new WorkflowError(`${name} must be a non-empty string.`);
	}
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
	 * Validates and retains one declaration without installing an SDK handler.
	 * @param declaration - Task name and retry policy allowed into transactional admission.
	 * @throws WorkflowError when the name, retry policy, or reviewed queue is invalid or conflicts.
	 */
	declare(declaration: IWorkflowTaskDeclaration): void
	{
		// 1. Validate the name and retry policy before either becomes admission state.
		const normalized = __NormalizeWorkflowTaskDeclaration(declaration);
		const taskName = normalized.taskName;
		const retryPolicy = normalized.retryPolicy;
		// 2. Reject a declaration that would change the retry behavior already selected for this task.
		const existing = this.declarations.get(taskName);
		if (existing !== undefined && !__HaveSameWorkflowTaskRetryPolicy(existing.retryPolicy ?? retryPolicy, retryPolicy))
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
