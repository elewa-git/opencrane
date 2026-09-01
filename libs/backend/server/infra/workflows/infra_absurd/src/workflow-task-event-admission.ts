import type { Prisma } from "@prisma/client";

import { AbsurdWorkflowError } from "./absurd-workflow-error";
import type { IWorkflowTaskEventAdmission } from "./workflow-task-event-admission.types";
import { _RequireWorkflowTransactionClient } from "./workflow-transaction-client";

/** Rejects an empty event or queue name before it reaches the vendor procedure. */
function _RequiredString(name: string, value: string): string
{
	if (value.trim().length === 0)
	{
		throw new Error(`${name} must be a non-empty string.`);
	}
	return value;
}

/**
 * Delivers an Absurd event through the product transaction that persisted its outcome.
 *
 * Absurd keeps event payloads immutable per queue and event name, so repeated delivery is
 * idempotent. The task identifier is already part of the event name supplied by the engine; this
 * adapter only serializes the payload and invokes the fixed procedure with bound parameters.
 *
 * Called by: `AbsurdWorkflowEngine.emitEventInTransaction`.
 */
export class WorkflowTaskEventAdmission implements IWorkflowTaskEventAdmission
{
	/** Queue selected by the same reviewed authority used by task admission and workers. */
	private readonly queueName: string;

	/** Binds transactional event delivery to one reviewed Absurd queue. */
	constructor(queueName: string)
	{
		this.queueName = _RequiredString("queueName", queueName);
	}

	/** Delivers one JSON-compatible event without leaving the caller's transaction. */
	async emit(transactionClient: unknown, eventName: string, payload: unknown): Promise<void>
	{
		_RequireWorkflowTransactionClient(transactionClient);
		const client = transactionClient as Prisma.TransactionClient;
		const acceptedEventName = _RequiredString("eventName", eventName);
		let serializedPayload: string;
		try
		{
			serializedPayload = JSON.stringify(payload ?? null);
		}
		catch (cause)
		{
			throw new AbsurdWorkflowError("serialize task event", cause);
		}
		try
		{
			await client.$queryRaw<readonly unknown[]>`
				SELECT absurd.emit_event(${this.queueName}, ${acceptedEventName}, ${serializedPayload}::jsonb)
			`;
		}
		catch (cause)
		{
			throw new AbsurdWorkflowError("emit task event", cause);
		}
	}
}
