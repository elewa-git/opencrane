import { Prisma } from "@prisma/client";

import { AbsurdWorkflowError } from "./absurd-workflow-error";
import type { AbsurdSpawnReceipt, AbsurdSpawnRequest, AbsurdTaskAdmissionProcedure } from "./absurd-transaction-spawner.types";

interface _SpawnTaskRow
{
	/** Raw task identity returned by the vendor procedure. */
	readonly task_id: unknown;
	/** Raw run identity returned by the vendor procedure. */
	readonly run_id: unknown;
	/** Raw attempt number returned by the vendor procedure. */
	readonly attempt: unknown;
	/** Raw new-task flag returned by the vendor procedure. */
	readonly created: unknown;
}

/** Reject an invalid task identity before it reaches the fixed database procedure. */
function _RequiredString(name: string, value: string): string
{
	if (value.trim().length === 0)
	{
		throw new Error(`${name} must be a non-empty string.`);
	}
	return value;
}

/** Encode task identity with a domain key so one queue cannot alias different task definitions. */
export function _AbsurdTaskScopedIdempotencyKey(taskName: string, idempotencyKey: string): string
{
	return JSON.stringify([_RequiredString("taskName", taskName), _RequiredString("idempotencyKey", idempotencyKey)]);
}

/** Narrow the opaque port transaction at the one adapter boundary allowed to know Prisma. */
function _RequireTransactionClient(client: unknown): Prisma.TransactionClient
{
	if (typeof client !== "object" || client === null || typeof Reflect.get(client, "$queryRaw") !== "function")
	{
		throw new Error("Durable task spawn requires a caller-owned Prisma TransactionClient.");
	}
	return client as Prisma.TransactionClient;
}

/** Validate the exact function result rather than treating a malformed vendor response as an admission. */
function _Receipt(rows: readonly _SpawnTaskRow[]): AbsurdSpawnReceipt
{
	if (rows.length !== 1)
	{
		throw new Error("Absurd spawn_task must return exactly one task receipt.");
	}
	const row = rows[0];
	if (typeof row.task_id !== "string" || row.task_id.trim().length === 0 || typeof row.run_id !== "string" || row.run_id.trim().length === 0 || typeof row.attempt !== "number" || !Number.isSafeInteger(row.attempt) || row.attempt < 1 || typeof row.created !== "boolean")
	{
		throw new Error("Absurd spawn_task returned an invalid task receipt.");
	}
	return { taskId: row.task_id, runId: row.run_id, attempt: row.attempt, created: row.created };
}

/**
 * Owns the fixed PostgreSQL procedure boundary between OpenCrane and Absurd.
 *
 * Called by: `AbsurdDurableExecution.spawn`. It does not accept SQL text, table names, or an
 * arbitrary procedure name: this class can call only the reviewed `absurd.spawn_task` function.
 * The caller's transaction remains open around the call, so a product write and task admission
 * share one commit decision.
 */
export class PrismaDbProcedureGateway implements AbsurdTaskAdmissionProcedure
{
	/** Absurd queue selected by app composition after kit policy scopes it. */
	private readonly queueName: string;

	/** Create the gateway for one already-created Absurd queue. */
	constructor(queueName: string)
	{
		this.queueName = _RequiredString("queueName", queueName);
	}

	/**
	 * Call the one reviewed durable-admission procedure through the caller-owned transaction.
	 *
	 * Parameters are bound by `Prisma.sql`; they never become SQL text. The method deliberately
	 * exposes no generic `selectString` or `procedureString` argument, which would turn this
	 * isolated bridge into an unrestricted raw-SQL escape hatch.
	 */
	async ___DbProcedureCall(transactionClient: unknown, request: AbsurdSpawnRequest): Promise<AbsurdSpawnReceipt>
	{
		const client = _RequireTransactionClient(transactionClient);
		const taskName = _RequiredString("taskName", request.taskName);
		const idempotencyKey = _RequiredString("idempotencyKey", request.idempotencyKey);
		let input: string;
		try
		{
			input = JSON.stringify(request.input);
		}
		catch (cause)
		{
			throw new AbsurdWorkflowError("serialize task input", cause);
		}
		if (input === undefined)
		{
			throw new Error("Durable task input must be JSON-serializable.");
		}
		const retryStrategy: Record<string, number | string> = { kind: request.retryStrategy.kind, base_seconds: request.retryStrategy.baseSeconds };
		if (request.retryStrategy.factor !== undefined) retryStrategy.factor = request.retryStrategy.factor;
		if (request.retryStrategy.maxSeconds !== undefined) retryStrategy.max_seconds = request.retryStrategy.maxSeconds;
		const options = JSON.stringify({ idempotency_key: _AbsurdTaskScopedIdempotencyKey(taskName, idempotencyKey), max_attempts: request.maximumAttempts, retry_strategy: retryStrategy });
		try
		{
			const rows = await client.$queryRaw<readonly _SpawnTaskRow[]>(Prisma.sql`
				SELECT task_id, run_id, attempt, created
				FROM absurd.spawn_task(${this.queueName}, ${taskName}, ${input}::jsonb, ${options}::jsonb)
			`);
			return _Receipt(rows);
		}
		catch (cause)
		{
			if (cause instanceof Error && (cause.message.includes("must return exactly one") || cause.message.includes("returned an invalid")))
			{
				throw cause;
			}
			throw new AbsurdWorkflowError("spawn task", cause);
		}
	}
}
