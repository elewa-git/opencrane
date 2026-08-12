import { Prisma, type PrismaClient } from "@prisma/client";
import { ___DoWithTrace } from "@opencrane/backend/observability";

import { __DecideDeferredToolRequest } from "./deferred-tool-approval.js";
import type { DecideDeferredToolRequestCommand, DecideDeferredToolRequestResult, DeferredToolApprovalDecisionRepository } from "./deferred-tool-approval-decision.types.js";

/**
 * Records one approval decision in a serializable transaction.
 *
 * Serializable is required, not a preference: the decision re-reads the approval, the run, and the
 * tool call, and applies the reviewer's arguments, and none of that may see a torn state.
 *
 * A database trigger aborts the transaction if the run's workload authority changed underneath;
 * that abort is translated into a plain `conflict` so the route answers 404 rather than 500.
 *
 * Called by: ./prisma-deferred-tool-approval.router.ts.
 */
export class PrismaDeferredToolApprovalDecisionRepository implements DeferredToolApprovalDecisionRepository
{
	/** Prisma client used to run the decision's read and its conditional update in one transaction. */
	private readonly _prisma: PrismaClient;

	/** Construct the repository around the server's Prisma client. */
	constructor(prisma: PrismaClient)
	{
		this._prisma = prisma;
	}

	/** Decide one owner-bound request inside one database transaction. */
	async decideAtomically(command: DecideDeferredToolRequestCommand): Promise<DecideDeferredToolRequestResult>
	{
		const prisma = this._prisma;
		return ___DoWithTrace("approval.decide.db", { siloId: command.siloId, subjectId: command.subjectId }, async function _traceDecideDb()
		{
			try
			{
				return await prisma.$transaction(async function _decide(transaction): Promise<DecideDeferredToolRequestResult>
				{
					return __DecideDeferredToolRequest(transaction, command);
				}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
			}
			catch (error)
			{
				if (_isStaleApprovalDecision(error)) return { outcome: "conflict" };
				throw error;
			}
		});
	}
}

/** Returns whether the database rejected the decision because the run attempt, its workload assignment, or its proof key is no longer current. */
function _isStaleApprovalDecision(error: unknown): boolean
{
	return error instanceof Error && error.message.includes("ApprovalRequest decision authority is no longer current");
}
