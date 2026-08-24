import { DurableExecutionError } from "@opencrane/backend/server/infra/workflows/contract";

/**
 * Reports data that cannot safely be saved by a workflow engine.
 *
 * Called by: the workflow input parser and payload validator. The error deliberately omits the
 * rejected value, because task input may have originated outside the current process.
 */
export class WorkflowPayloadValidationError extends DurableExecutionError
{
	/** Create a rejection that does not echo the unsafe value or its field name. */
	constructor()
	{
		super("Workflow payload violates the durable execution boundary.");
		this.name = "WorkflowPayloadValidationError";
	}
}

/**
 * Reports work that is absent from the silo's reviewed task-to-queue policy.
 *
 * Called by: the workflow kit while it registers, admits, emits to, or awaits a task. The error
 * does not include the resolved queue, because queue configuration is internal infrastructure.
 */
export class WorkflowTaskPolicyError extends DurableExecutionError
{
	/** Create a policy rejection that does not reveal internal queue configuration. */
	constructor()
	{
		super("Workflow task is not admitted by this silo policy.");
		this.name = "WorkflowTaskPolicyError";
	}
}
