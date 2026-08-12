import { Prisma, type PrismaClient } from "@prisma/client";
import type { ConversationProjectionReadResult, ReadConversationProjectionCommand } from "@opencrane/backend/conversations/projection";

import { PrismaConversationReplayRepository } from "./prisma-conversation-replay-repository.js";
import type { ConversationReplayUnitOfWork } from "./replay-reader.types.js";

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

	/** Recheck authority and rows inside one repeatable-read transaction. */
	async readAuthorized(command: ReadConversationProjectionCommand): Promise<ConversationProjectionReadResult>
	{
		return this.prisma.$transaction(async function _ReadReplaySnapshot(transaction)
		{
			return new PrismaConversationReplayRepository(transaction).readAuthorized(command);
		}, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
	}
}
