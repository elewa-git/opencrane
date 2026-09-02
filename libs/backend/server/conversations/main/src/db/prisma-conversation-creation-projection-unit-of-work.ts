import type { PrismaClient } from "@prisma/client";

import { ___RunInPrismaUnitOfWork } from "@opencrane/backend/server/infra/prisma-unit-of-work";
import { ConversationHistoryReader } from "../conversation-history-reader";
import type { ConversationCreationProjectionCommand, ConversationCreationProjectionPort } from "../history-anchored-conversation-creation-authority.types";
import { PrismaConversationCreationProjectionRepository } from "./prisma-conversation-creation-projection-repository";

/** Materializes a confirmed creation anchor before recording the reservation's final progress state. */
export class PrismaConversationCreationProjectionUnitOfWork implements ConversationCreationProjectionPort
{
	/** Holds the database transaction runner and read-only immutable history authority. */
	public constructor(private readonly prisma: PrismaClient, private readonly history: Pick<ConversationHistoryReader, "readCreation">) {}

	/** @inheritdoc */
	public async request(command: ConversationCreationProjectionCommand): Promise<void>
	{
		const created = await this.history.readCreation({ siloId: command.siloId, conversationId: command.conversationId });
		await ___RunInPrismaUnitOfWork(this.prisma, async function _Project(transaction): Promise<void>
		{
			return new PrismaConversationCreationProjectionRepository(transaction).project(command, created);
		}, { isolationLevel: "Serializable", attemptLimit: 3, operation: "conversation creation projection" });
	}
}
