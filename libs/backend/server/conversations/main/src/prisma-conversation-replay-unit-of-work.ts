import { Prisma, type PrismaClient } from "@prisma/client";

import { PrismaConversationReplayRepository } from "./prisma-conversation-replay-repository.js";
import type { ConversationReplayUnitOfWork, ReadConversationReplayCommand } from "./replay-reader.types.js";
import type { ConversationReplayEventRow } from "./replay-projection.types.js";

/** Prisma transaction boundary that freezes participant bounds and visible timeline rows together. */
export class PrismaConversationReplayUnitOfWork implements ConversationReplayUnitOfWork
{
	/** Root client used only to open the replay snapshot transaction. */
	private readonly prisma: PrismaClient;

	/** Creates the replay unit of work over the canonical product database. */
	constructor(prisma: PrismaClient)
	{
		this.prisma = prisma;
	}

	/** Reads participant bounds and timeline rows from one repeatable database snapshot. */
	async read(command: ReadConversationReplayCommand): Promise<readonly ConversationReplayEventRow[]>
	{
		return this.prisma.$transaction(async function _ReadReplaySnapshot(transaction)
		{
			return new PrismaConversationReplayRepository(transaction).read(command);
		}, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
	}
}
