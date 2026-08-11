import { ToolInvocationState, ToolResultDeliveryState, type Prisma } from "@prisma/client";

import { __DigestCanonicalJson } from "@opencrane/backend/server/iam/authorization";
import type { RuntimeToolResult } from "@opencrane/contracts";
import type { JsonValue } from "@opencrane/util";

import type { RuntimeResumeInputLoad, RuntimeResumeInputRepository, RuntimeResumeInputUnitOfWork } from "./runtime-resume-input.types.js";

/** Prisma marker loader bound to one caller-owned dispatch transaction. */
export class PrismaRuntimeResumeInputRepository implements RuntimeResumeInputRepository
{
	/** Exact dispatch transaction, never the process-owned root client. */
	private readonly _transaction: Prisma.TransactionClient;

	/** Bind marker reads to the transaction that will persist and consume their command. */
	constructor(transaction: Prisma.TransactionClient)
	{
		this._transaction = transaction;
	}

	/** Load every pending saved result and steering item in deterministic order. */
	async load(runId: string, attempt: number, inputGeneration: number): Promise<RuntimeResumeInputLoad | null>
	{
		// A multi-tool batch resumes only after every invocation is terminal. This prevents a partial
		// result command from restarting the model while a sibling action is still in flight.
		const unresolved = await this._transaction.toolInvocation.count({ where: { runId, attempt, state: { notIn: [ToolInvocationState.Succeeded, ToolInvocationState.Failed] } } });
		if (unresolved > 0) return null;
		const deliveries = await this._transaction.toolResultDelivery.findMany({ where: { state: ToolResultDeliveryState.Pending, invocation: { runId, attempt } }, include: { invocation: { select: { toolInvocationId: true } } }, orderBy: { createdAt: "asc" } });
		const steering = await this._transaction.runtimeSteeringRequest.findMany({ where: { runId, attempt, state: "Pending" }, orderBy: { submittedAt: "asc" } });
		if (deliveries.length === 0 && steering.length === 0) return null;
		for (const delivery of deliveries)
		{
			const payload = delivery.payload as unknown as JsonValue;
			if (__DigestCanonicalJson(payload) !== delivery.payloadDigest || !_PayloadNamesInvocation(payload, delivery.invocation.toolInvocationId)) return null;
		}
		const toolResults = deliveries.map(function _Result(row): RuntimeToolResult { return row.payload as unknown as RuntimeToolResult; });
		return { resume: { inputGeneration, toolResults, steeringRequests: steering.map(function _Content(row) { return row.content; }) as unknown as JsonValue }, toolResultDeliveryIds: deliveries.map(function _Id(row) { return row.id; }), steeringRequestIds: steering.map(function _Id(row) { return row.id; }) };
	}
}

/** Bind one saved runtime result to the public invocation id of its relational owner. */
function _PayloadNamesInvocation(payload: JsonValue, toolInvocationId: string): boolean
{
	return payload !== null
		&& typeof payload === "object"
		&& !Array.isArray(payload)
		&& (payload as Readonly<Record<string, JsonValue>>)["toolInvocationId"] === toolInvocationId;
}

/** Transaction-scoped unit that owns construction of the resume marker repository. */
export class PrismaRuntimeResumeInputUnitOfWork implements RuntimeResumeInputUnitOfWork
{
	/** Exact dispatch transaction. */
	private readonly _transaction: Prisma.TransactionClient;

	/** Bind repository construction to the caller-owned transaction. */
	constructor(transaction: Prisma.TransactionClient)
	{
		this._transaction = transaction;
	}

	/** Load resumable markers without exposing repository construction to dispatch. */
	async load(runId: string, attempt: number, inputGeneration: number): Promise<RuntimeResumeInputLoad | null>
	{
		return new PrismaRuntimeResumeInputRepository(this._transaction).load(runId, attempt, inputGeneration);
	}
}
