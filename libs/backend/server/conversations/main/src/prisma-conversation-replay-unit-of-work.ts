import { Prisma, type PrismaClient } from "@prisma/client";
import type { ConversationProjectionReadResult, ReadConversationProjectionCommand } from "@opencrane/backend/conversations/projection";

import { PrismaConversationReplayRepository } from "./prisma-conversation-replay-repository.js";
import type { ConversationReplayUnitOfWork } from "./replay-reader.types.js";

/**
 * Reads a replay page inside one repeatable-read transaction, so the access check and the rows
 * come from the same instant.
 *
 * Repeatable-read matters here: without it a membership could be withdrawn between the check
 * and the row read, and the page would go out to a user who had just lost access. This class
 * only opens and closes the transaction — the query itself lives in
 * `PrismaConversationReplayRepository`.
 *
 * Called by: `_CreateConversationReplayRepository`
 * (prisma-conversation-replay.composition.ts).
 *
 * @see https://www.prisma.io/docs/orm/prisma-client/queries/transactions for the isolation
 * level argument used here. NEEDS-HUMAN: confirm this is the right page for the pinned Prisma
 * version before keeping the link.
 */
export class PrismaConversationReplayUnitOfWork implements ConversationReplayUnitOfWork
{
	/** Root client used only to open the replay snapshot transaction. */
	private readonly prisma: PrismaClient;

	/** Creates the replay unit of work over the canonical product database. */
	constructor(prisma: PrismaClient)
	{
		this.prisma = prisma;
	}

	/**
	 * @returns The access decision and the page of rows, consistent with each other. Called
	 *   once per turn of the live loop, so each page is authorised afresh.
	 * @throws When the transaction cannot be opened or committed.
	 */
	async readAuthorized(command: ReadConversationProjectionCommand): Promise<ConversationProjectionReadResult>
	{
		return this.prisma.$transaction(async function _ReadReplaySnapshot(transaction)
		{
			return new PrismaConversationReplayRepository(transaction).readAuthorized(command);
		}, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
	}
}
