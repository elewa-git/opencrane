import { ApprovalRequestState, type Prisma } from "@prisma/client";

import type { DeferredToolResumeResult } from "@opencrane/contracts";
import type { JsonValue } from "@opencrane/util";

import type { RuntimeDeferredResumeLoad, RuntimeDeferredResumeRepository, RuntimeDeferredResumeUnitOfWork } from "./runtime-deferred-resume.types.js";

/** Prisma marker loader bound to one caller-owned dispatch transaction. */
export class PrismaRuntimeDeferredResumeRepository implements RuntimeDeferredResumeRepository
{
	/** Exact dispatch transaction, never the process-owned root client. */
	private readonly _transaction: Prisma.TransactionClient;

	/** Bind marker reads to the transaction that will persist and consume their command. */
	constructor(transaction: Prisma.TransactionClient)
	{
		this._transaction = transaction;
	}

	/** Load every resumable approval marker and pending steering item in deterministic order. */
	async load(runId: string, attempt: number, inputGeneration: number): Promise<RuntimeDeferredResumeLoad | null>
	{
		const approvals = await this._transaction.approvalRequest.findMany({ where: { runId, attempt, state: { in: [ApprovalRequestState.Approved, ApprovalRequestState.Denied, ApprovalRequestState.Expired] }, toolInvocationRowId: { not: null }, resumeTokenHash: { not: null } }, orderBy: { id: "asc" }, include: { toolInvocation: { select: { toolInvocationId: true } } } });
		const steering = await this._transaction.runtimeSteeringRequest.findMany({ where: { runId, attempt, state: "Pending" }, orderBy: { submittedAt: "asc" } });
		if (approvals.length === 0 && steering.length === 0) return null;
		const deferredToolResults = approvals.map(function _Result(row): DeferredToolResumeResult
		{
			if (row.toolInvocation === null) throw new Error("deferred tool request has incomplete invocation linkage");
			if (row.state === ApprovalRequestState.Denied) return { approvalRequestId: row.id, decision: "denied", toolInvocationId: row.toolInvocation.toolInvocationId, failureCode: "approval_denied" };
			if (row.state === ApprovalRequestState.Expired) return { approvalRequestId: row.id, decision: "expired", toolInvocationId: row.toolInvocation.toolInvocationId, failureCode: "approval_expired" };
			if (row.state !== ApprovalRequestState.Approved || row.finalArguments === null || typeof row.finalArgumentsDigest !== "string") throw new Error("approved deferred tool request has incomplete resume authority");
			return { approvalRequestId: row.id, decision: "approved", toolInvocationId: row.toolInvocation.toolInvocationId, arguments: row.finalArguments as JsonValue, argumentsDigest: row.finalArgumentsDigest };
		});
		const steeringRequests = steering.map(function _Content(row): JsonValue { return row.content as JsonValue; });
		return { resume: { inputGeneration, deferredToolResults, steeringRequests }, approvalIds: approvals.map(function _Id(row) { return row.id; }), steeringRequestIds: steering.map(function _Id(row) { return row.id; }) };
	}
}

/** Transaction-scoped unit that owns construction of the resume marker repository. */
export class PrismaRuntimeDeferredResumeUnitOfWork implements RuntimeDeferredResumeUnitOfWork
{
	/** Exact dispatch transaction. */
	private readonly _transaction: Prisma.TransactionClient;

	/** Bind repository construction to the caller-owned transaction. */
	constructor(transaction: Prisma.TransactionClient)
	{
		this._transaction = transaction;
	}

	/** Load resumable markers without exposing repository construction to dispatch. */
	async load(runId: string, attempt: number, inputGeneration: number): Promise<RuntimeDeferredResumeLoad | null>
	{
		return new PrismaRuntimeDeferredResumeRepository(this._transaction).load(runId, attempt, inputGeneration);
	}
}
