import { DurableExecutionError } from "@opencrane/backend/server/infra/workflows/contract";

/**
 * A vendor operation failed before the durable port could return its promised value.
 *
 * The adapter retains the original failure as `cause` for structured logs while keeping vendor
 * error classes out of package consumers.
 */
export class AbsurdWorkflowError extends DurableExecutionError
{
	/** Engine operation that failed. */
	readonly operation: string;

	/** Creates an engine-neutral failure that preserves its vendor cause. */
	constructor(operation: string, cause: unknown)
	{
		super(`Absurd ${operation} failed.`);
		this.cause = cause;
		this.name = "AbsurdWorkflowError";
		this.operation = operation;
	}
}
