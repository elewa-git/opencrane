import type { Pool } from "pg";

import type { WorkflowTaskTerminalError } from "@opencrane/backend/server/infra/workflows/contract";

/** Store one terminal handler failure before the SDK worker can apply its general retry policy. */
export class _AbsurdTerminalTaskFailure
{
	/** Shared engine pool used by the worker that owns the current run. */
	private readonly databasePool: Pool;
	/** Reviewed queue containing the task and its active run. */
	private readonly queueName: string;

	/** Bind terminal settlement to the current queue and the adapter's existing pool. */
	constructor(databasePool: Pool, queueName: string)
	{
		this.databasePool = databasePool;
		this.queueName = queueName;
	}

	/** Mark the task failed without creating the later attempt used for a retryable error. */
	async fail(taskId: string, error: WorkflowTaskTerminalError): Promise<void>
	{
		const reason = JSON.stringify({ name: error.name, message: error.message });
		await this.databasePool.query('SELECT public."fail_absurd_task_terminal"($1, $2::uuid, $3::jsonb)', [this.queueName, taskId, reason]);
	}
}
