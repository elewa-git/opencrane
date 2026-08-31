import { ElicitationRequestState, ToolInvocationState, type Prisma } from "@prisma/client";

import type { RuntimeWaitInvocationRecord, RuntimeWaitReasonRepository } from "./runtime-wait-reasons.types";

/** Reads the bounded active rows used to derive wait reasons on the caller's dispatch transaction. */
export class PrismaRuntimeWaitReasonRepository implements RuntimeWaitReasonRepository
{
	/** The dispatch transaction that already owns the run lock. */
	private readonly _transaction: Prisma.TransactionClient;

	/** Keep every wait read inside the caller's existing transaction. */
	constructor(transaction: Prisma.TransactionClient)
	{
		this._transaction = transaction;
	}

	/** Read nonterminal tool invocations for this exact run attempt. */
	async readInvocations(runId: string, attempt: number): Promise<readonly RuntimeWaitInvocationRecord[]>
	{
		return this._transaction.toolInvocation.findMany({ where: { runId, attempt, state: { notIn: [ToolInvocationState.Succeeded, ToolInvocationState.Failed] } }, select: { state: true, toolRevisionId: true } });
	}

	/** Read requested elicitation purposes for this exact run attempt. */
	async readElicitationPurposes(runId: string, attempt: number): Promise<readonly string[]>
	{
		const requests = await this._transaction.elicitationRequest.findMany({ where: { runId, attempt, state: ElicitationRequestState.Requested }, select: { purpose: true } });
		return requests.map(function _Purpose(request) { return request.purpose; });
	}
}
