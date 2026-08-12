import { ToolInvocationState, ToolResultDeliveryState, type Prisma } from "@prisma/client";

import { __DigestCanonicalJson } from "@opencrane/backend/server/iam/authorization";
import type { RuntimeToolResult } from "@opencrane/contracts";
import type { JsonValue } from "@opencrane/util";

import type { RuntimeResumeInputLoad, RuntimeResumeInputRepository, RuntimeResumeInputUnitOfWork } from "./runtime-resume-input.types.js";

/**
 * Loads the pending tool results and steering rows a resume command would carry.
 *
 * Reads on the caller's dispatch transaction, because the same transaction will save the resume
 * command and mark these rows consumed - reading them on another connection could pick up rows a
 * different command has already claimed.
 *
 * Called by: `PrismaRuntimeResumeInputUnitOfWork.load` and
 * `PrismaRuntimeCommandDecisionUnitOfWork.decide`.
 *
 * @implements RuntimeResumeInputRepository
 */
export class PrismaRuntimeResumeInputRepository implements RuntimeResumeInputRepository
{
	/** The caller's dispatch transaction, never the process-wide Prisma client. */
	private readonly _transaction: Prisma.TransactionClient;

	/** Read on the same transaction that will save the resume command and mark these rows consumed. */
	constructor(transaction: Prisma.TransactionClient)
	{
		this._transaction = transaction;
	}

	/** Load every pending tool result and steering row, always in the same order. */
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

/** Return whether a saved tool result names the invocation row it is attached to. */
function _PayloadNamesInvocation(payload: JsonValue, toolInvocationId: string): boolean
{
	return payload !== null
		&& typeof payload === "object"
		&& !Array.isArray(payload)
		&& (payload as Readonly<Record<string, JsonValue>>)["toolInvocationId"] === toolInvocationId;
}

/**
 * Creates the resume-input repository on the caller's transaction, and forwards to it.
 *
 * Exists so command dispatch never constructs a Prisma-facing repository itself.
 *
 * Called by: `_mintCommandExtras` in prisma-runtime-dispatch-authority.ts.
 *
 * @implements RuntimeResumeInputUnitOfWork
 */
export class PrismaRuntimeResumeInputUnitOfWork implements RuntimeResumeInputUnitOfWork
{
	/** Exact dispatch transaction. */
	private readonly _transaction: Prisma.TransactionClient;

	/** Store the caller's transaction, to build the repository on later. */
	constructor(transaction: Prisma.TransactionClient)
	{
		this._transaction = transaction;
	}

	/** Load the pending tool results and steering rows, hiding how the repository is built. */
	async load(runId: string, attempt: number, inputGeneration: number): Promise<RuntimeResumeInputLoad | null>
	{
		return new PrismaRuntimeResumeInputRepository(this._transaction).load(runId, attempt, inputGeneration);
	}
}
