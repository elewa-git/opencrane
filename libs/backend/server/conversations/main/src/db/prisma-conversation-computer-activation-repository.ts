import type { Prisma } from "@prisma/client";

import type { ConversationComputerActivationCommand, ConversationComputerActivationProjection, ConversationComputerActivationProjectionRepository } from "../conversation-computer-activation.types";

/** Resolves immutable computer coordinates from the rebuildable relational projection. */
export class PrismaConversationComputerActivationProjectionRepository implements ConversationComputerActivationProjectionRepository
{
	/** Connects the narrow coordinate read to the product database. */
	public constructor(private readonly prisma: Prisma.TransactionClient) {}

	/** Return coordinates only for the exact silo, conversation and computer tuple. */
	public async resolve(command: ConversationComputerActivationCommand): Promise<ConversationComputerActivationProjection | null>
	{
		const row = await this.prisma.conversation.findFirst({ where: { id: command.conversationId, siloId: command.siloId, computerId: command.computerId }, select: { computerAgentIdentityId: true, computerProfileRevisionId: true } });
		if (row?.computerAgentIdentityId === null || row?.computerProfileRevisionId === null || row === null)
			return null;
		return { agentIdentityId: row.computerAgentIdentityId, profileRevisionId: row.computerProfileRevisionId };
	}
}
