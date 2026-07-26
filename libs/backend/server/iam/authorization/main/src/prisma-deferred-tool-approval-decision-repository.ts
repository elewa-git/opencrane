import type { PrismaClient } from "@prisma/client";

import { __DecideDeferredToolRequest } from "./deferred-tool-approval.js";
import type { DecideDeferredToolRequestCommand, DecideDeferredToolRequestResult, DeferredToolApprovalDecisionRepository } from "./deferred-tool-approval.types.js";

/** Prisma-backed atomic persistence for session-authorized deferred-tool decisions. */
export class PrismaDeferredToolApprovalDecisionRepository implements DeferredToolApprovalDecisionRepository
{
	/** Canonical product authority used to group the decision read and compare-and-set. */
	private readonly _prisma: PrismaClient;

	/** Construct the repository around the server's canonical product-authority client. */
	constructor(prisma: PrismaClient)
	{
		this._prisma = prisma;
	}

	/** Decide one owner-bound request inside one database transaction. */
	async decideAtomically(command: DecideDeferredToolRequestCommand): Promise<DecideDeferredToolRequestResult>
	{
		return this._prisma.$transaction(async function _decide(transaction): Promise<DecideDeferredToolRequestResult>
		{
			return __DecideDeferredToolRequest(transaction, command);
		});
	}
}
