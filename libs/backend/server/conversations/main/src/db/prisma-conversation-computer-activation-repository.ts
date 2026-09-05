import type { Prisma } from "@prisma/client";

import type { ConversationComputerActivationCommand, ConversationComputerActivationProjection, ConversationComputerActivationProjectionRepository, ConversationComputerActiveLeaseProjectionCommand } from "../conversation-computer-activation.types";

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

	/** Publish the exact canonical lease, including an expired lease replayed after an outage. */
	public async publishActiveLease(command: ConversationComputerActiveLeaseProjectionCommand): Promise<void>
	{
		const expiresAt = new Date(command.expiresAt);
		if (Number.isNaN(expiresAt.getTime()))
			throw new Error("Conversation computer active lease projection requires a valid expiry");
		await this.prisma.conversationComputerActiveLease.upsert({ where: { computerId: command.computerId }, create: { siloId: command.siloId, conversationId: command.conversationId, computerId: command.computerId, agentIdentityId: command.agentIdentityId, leaseId: command.leaseId, leaseGeneration: command.leaseGeneration, expiresAt }, update: {} });
		const existing = await this.prisma.conversationComputerActiveLease.findUnique({ where: { computerId: command.computerId } });
		if (existing === null || existing.siloId !== command.siloId || existing.conversationId !== command.conversationId || existing.agentIdentityId !== command.agentIdentityId || existing.leaseId !== command.leaseId || existing.leaseGeneration !== command.leaseGeneration || existing.expiresAt.getTime() !== expiresAt.getTime())
			throw new Error("Conversation computer active lease projection conflicts with current authority");
	}
}
