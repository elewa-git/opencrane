import type { Prisma } from "@prisma/client";

import type { ConversationElicitation } from "@opencrane/contracts";

import type { ExpireElicitationBatchCommand, ExpireElicitationBatchResult, OpenElicitationCommand } from "./elicitation.types.js";
import { PrismaElicitationRepository } from "./prisma-elicitation-unit-of-work.js";

/**
 * Owns elicitation work inside a runtime dispatch transaction that already holds the run lock.
 *
 * This adapter never starts a nested transaction. Its repository is constructed from the exact
 * transaction supplied by runtime dispatch, so opening and expiring requests share the caller's
 * locks and commit or roll back with the surrounding command or candidate decision.
 */
export class PrismaRuntimeElicitationUnitOfWork
{
	/** Exact runtime dispatch transaction used by this unit of work. */
	private readonly _transaction: Prisma.TransactionClient;
	/** Elicitation repository bound to the exact runtime dispatch transaction. */
	private readonly _repository: PrismaElicitationRepository;

	/** Bind runtime elicitation work to the caller's existing transaction. */
	constructor(transaction: Prisma.TransactionClient)
	{
		this._transaction = transaction;
		this._repository = new PrismaElicitationRepository(this._transaction);
	}

	/** Open or exactly replay one validated runtime request. */
	open(command: OpenElicitationCommand): Promise<ConversationElicitation | null>
	{
		return this._repository.open(command);
	}

	/** Expire due runtime requests while the caller still holds the run lock. */
	expireDue(command: ExpireElicitationBatchCommand): Promise<ExpireElicitationBatchResult>
	{
		return this._repository.expireDue(command);
	}
}
