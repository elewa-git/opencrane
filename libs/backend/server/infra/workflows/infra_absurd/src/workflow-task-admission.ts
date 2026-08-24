import { Prisma } from "@prisma/client";

import { AbsurdWorkflowError } from "./absurd-workflow-error";
import type { IWorkflowTaskAdmission, IWorkflowTaskAdmissionReceipt, IWorkflowTaskAdmissionRequest } from "./workflow-task-admission.types";

/** Represents the raw row that Absurd returns after it accepts or matches a task. */
interface IAdmissionResultRow
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

/** Rejects an empty task identity before it becomes part of the vendor procedure call. */
function _RequiredString(name: string, value: string): string
{
	if (value.trim().length === 0)
	{
		throw new Error(`${name} must be a non-empty string.`);
	}
	return value;
}

/**
 * Scopes a domain idempotency key by task name before it reaches a queue shared by task types.
 *
 * Absurd matches repeated admissions by this stored key. Encoding both values prevents two task
 * definitions from matching each other merely because their callers used the same domain key.
 */
export function _TaskScopedIdempotencyKey(taskName: string, idempotencyKey: string): string
{
	return JSON.stringify([_RequiredString("taskName", taskName), _RequiredString("idempotencyKey", idempotencyKey)]);
}

/**
 * Narrows the opaque transaction at the one adapter boundary allowed to know Prisma.
 *
 * The workflow contract keeps this value opaque so domain code cannot issue raw database calls.
 * A root Prisma client exposes `$transaction`, unlike the transaction client passed to this method,
 * so this check rejects it before the task can be admitted outside the product transaction.
 */
function _RequireTransactionClient(client: unknown): Prisma.TransactionClient
{
	if (typeof client !== "object" || client === null || typeof Reflect.get(client, "$queryRaw") !== "function" || typeof Reflect.get(client, "$transaction") === "function")
	{
		throw new Error("Workflow task spawn requires a caller-owned Prisma TransactionClient.");
	}
	return client as Prisma.TransactionClient;
}

/**
 * Validates the vendor result before the engine reports that it admitted a task.
 *
 * `absurd.spawn_task` returns one row for both a new task and an idempotency match. A match carries
 * its existing task, run, and attempt values with `created: false`; any other shape is ambiguous,
 * so the caller receives an error instead of a receipt it cannot trust.
 */
function _AdmissionReceipt(rows: readonly IAdmissionResultRow[]): IWorkflowTaskAdmissionReceipt
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
 * Admits a workflow task through the product transaction that requested it.
 *
 * {@link AbsurdWorkflowEngine.spawn} uses this class when a product write also needs asynchronous
 * work. Both operations use the same transaction, so they commit or roll back together. The class
 * exposes no SQL text, table name, or procedure name: its one parameterized query is the sole
 * OpenCrane production call to `absurd.spawn_task`.
 *
 * Called by: {@link AbsurdWorkflowEngine.spawn}.
 * @see ../../../../../../../docs/adr/0013-workflow-control-plane.md — records why task admission shares the product transaction.
 */
export class WorkflowTaskAdmission implements IWorkflowTaskAdmission
{
	/** Stores the reviewed queue selected by workflow composition for this task type. */
	private readonly queueName: string;

	/**
	 * Creates task admission for one queue that bootstrap already created.
	 *
	 * @param queueName Queue selected by the same authority used by the workflow engine.
	 */
	constructor(queueName: string)
	{
		this.queueName = _RequiredString("queueName", queueName);
	}

	/**
	 * Admits a task through the caller's open product transaction.
 *
	 * The method serializes the task input, scopes its idempotency key, and calls the fixed Absurd
	 * procedure with bound parameters. It rejects malformed results before the workflow engine can
	 * report success. Callers receive {@link AbsurdWorkflowError} when serialization or database
	 * work fails, while a malformed vendor response remains a direct error for diagnosis.
	 *
	 * @param transactionClient Opaque transaction supplied by the product write that admits work.
	 * @param request Task name, domain idempotency key, and JSON-compatible input to submit.
	 * @returns The Absurd receipt for a new task or an existing idempotency match.
	 * @throws When the transaction, input, or vendor receipt is invalid, or the vendor call fails.
	 * @see IWorkflowTaskAdmission — defines the transaction boundary this class fulfils.
	 */
	async admit(transactionClient: unknown, request: IWorkflowTaskAdmissionRequest): Promise<IWorkflowTaskAdmissionReceipt>
	{
		// 1. Verify the supplied object is the product transaction that owns the commit decision.
		const client = _RequireTransactionClient(transactionClient);
		// 2. Validate identity and serialize input before the fixed query receives any values.
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
		throw new Error("Workflow task input must be JSON-serializable.");
		}
		// 3. Translate the retry policy and call the approved procedure with bound parameters.
		const retryStrategy: Record<string, number | string> = { kind: request.retryStrategy.kind, base_seconds: request.retryStrategy.baseSeconds };
		if (request.retryStrategy.factor !== undefined)
			retryStrategy.factor = request.retryStrategy.factor;
		if (request.retryStrategy.maxSeconds !== undefined)
			retryStrategy.max_seconds = request.retryStrategy.maxSeconds;
		const admissionOptions = JSON.stringify({ idempotency_key: _TaskScopedIdempotencyKey(taskName, idempotencyKey), max_attempts: request.maximumAttempts, retry_strategy: retryStrategy });
		try
		{
			const rows = await client.$queryRaw<readonly IAdmissionResultRow[]>(Prisma.sql`
				SELECT task_id, run_id, attempt, created
				FROM absurd.spawn_task(${this.queueName}, ${taskName}, ${input}::jsonb, ${admissionOptions}::jsonb)
			`);
			return _AdmissionReceipt(rows);
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
