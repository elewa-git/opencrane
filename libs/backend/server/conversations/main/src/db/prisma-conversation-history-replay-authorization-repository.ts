import { OrgMemberStatus, type Prisma } from "@prisma/client";

import type { ReadConversationProjectionCommand } from "@opencrane/backend/conversations/projection";

import type { ConversationHistoryReplayAccess, ConversationHistoryReplayAuthorizationRepository as ConversationHistoryReplayAuthorizationRepositoryPort } from "../replay-reader.types";

/** Reads current PostgreSQL access facts that bound a later immutable-history replay. */
export class PrismaConversationHistoryReplayAuthorizationRepository implements ConversationHistoryReplayAuthorizationRepositoryPort
{
	/** Holds the transaction whose membership and participant facts form one access decision. */
	public constructor(private readonly transaction: Prisma.TransactionClient)
	{
	}

	/** Returns current visibility bounds without loading relational messages or timeline rows. */
	public async readAccess(command: ReadConversationProjectionCommand): Promise<ConversationHistoryReplayAccess | null>
	{
		if (command.cursor !== null && command.cursor.conversationId !== command.conversationId)
			return null;
		const membership = await this.transaction.orgMembership.findFirst({ where: { clusterTenant: command.siloId, subject: command.subjectId, status: OrgMemberStatus.Active }, select: { clusterTenant: true } });
		if (membership === null)
			return null;
		const participant = await this.transaction.conversationParticipant.findFirst({
			where: { conversationId: command.conversationId, userId: command.subjectId, conversation: _ConversationAccess(command) },
			select: { visibleFromPosition: true, accessEndedPosition: true },
		});
		return participant === null ? null : { visibleFromPosition: participant.visibleFromPosition, accessEndedPosition: participant.accessEndedPosition };
	}
}

/** Requires child-thread viewers to retain current access to their immediate parent conversation. */
function _ConversationAccess(command: ReadConversationProjectionCommand): Prisma.ConversationWhereInput
{
	return {
		siloId: command.siloId,
		OR: [
			{ originAgentThread: { is: null } },
			{ originAgentThread: { is: { parentConversation: { participants: { some: { userId: command.subjectId, accessEndedPosition: null } } } } } },
		],
	};
}
