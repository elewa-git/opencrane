import type { Prisma } from "@prisma/client";

import type { ConversationElicitation } from "@opencrane/contracts";

import type { ExpireElicitationBatchCommand, ExpireElicitationBatchResult, OpenElicitationCommand, RuntimeElicitationUnitOfWork } from "./elicitation.types.js";
import { PrismaElicitationRepository } from "./prisma-elicitation-unit-of-work.js";

/**
 * Owns elicitation work inside a runtime dispatch transaction that already holds the run lock.
 *
 * This adapter never starts a nested transaction. Its repository is constructed from the exact
 * transaction supplied by runtime dispatch, so opening and expiring requests share the caller's
 * locks and commit or roll back with the surrounding command or candidate decision.
 *
 * Called by: `_CreateProductionRuntimeElicitationUnitOfWorkFactory` binds an instance inside every
 * command-polling and candidate-admission transaction.
 *
 * @see RuntimeElicitationUnitOfWork in elicitation.types.ts
 */
export class PrismaRuntimeElicitationUnitOfWork implements RuntimeElicitationUnitOfWork
{
	/** Applies elicitation changes through that same dispatch transaction. */
	private readonly _repository: PrismaElicitationRepository;

	/**
	 * Binds elicitation work to the caller's existing transaction without starting another one.
	 *
	 * @param transaction - The dispatch transaction that already owns the run lock.
	 */
	constructor(transaction: Prisma.TransactionClient)
	{
		this._repository = new PrismaElicitationRepository(transaction);
	}

	/**
	 * Opens a validated request or replays the matching request within the dispatch decision.
	 *
	 * @param command - The request already bound to the admitted run, attempt, and participant.
	 * @returns The stored browser-safe request, or null when the proposal conflicts with live state.
	 */
	open(command: OpenElicitationCommand): Promise<ConversationElicitation | null>
	{
		return this._repository.open(command);
	}

	/**
	 * Expires due requests before command polling decides whether the waiting run can resume.
	 *
	 * @param command - The locked run attempt and trusted server time.
	 * @returns How many requests expired and whether their consequences resumed the run.
	 */
	expireDue(command: ExpireElicitationBatchCommand): Promise<ExpireElicitationBatchResult>
	{
		return this._repository.expireDue(command);
	}
}
