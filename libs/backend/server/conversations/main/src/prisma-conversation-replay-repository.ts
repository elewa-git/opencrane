import { ConversationTimelineEntryKind, OrgMemberStatus, type Prisma } from "@prisma/client";
import { __EncodeConversationProjectionCursor, ConversationProjectionReadStatuses, type ConversationProjectionEventRow, type ConversationProjectionReadResult, type ReadConversationProjectionCommand } from "@opencrane/backend/conversations/projection";

import type { ConversationReplayRepository } from "./replay-reader.types.js";

/** Prisma adapter that reads only participant-visible run events through canonical timeline order. */
export class PrismaConversationReplayRepository implements ConversationReplayRepository
{
	/** Transaction-scoped canonical product database snapshot. */
	private readonly prisma: Prisma.TransactionClient;

	/** Creates the read-only replay adapter inside its owning replay transaction. */
	constructor(prisma: Prisma.TransactionClient)
	{
		this.prisma = prisma;
	}

	/** Read a bounded page and retain the same-snapshot authority result for live streams. */
	async readAuthorized(command: ReadConversationProjectionCommand): Promise<ConversationProjectionReadResult>
	{
		// 1. Reject a foreign cursor before consulting any durable authority.
		if (command.cursor !== null && command.cursor.conversationId !== command.conversationId) return { status: ConversationProjectionReadStatuses.RevokedOrMissing, rows: [] };

		// 2. Require current organisation membership and participant bounds in this repeatable snapshot.
		const membership = await this.prisma.orgMembership.findFirst({ where: { clusterTenant: command.siloId, subject: command.subjectId, status: OrgMemberStatus.Active }, select: { clusterTenant: true } });
		if (membership === null) return { status: ConversationProjectionReadStatuses.RevokedOrMissing, rows: [] };
		const participant = await this.prisma.conversationParticipant.findUnique({ where: { conversationId_userId: { conversationId: command.conversationId, userId: command.subjectId } }, include: { conversation: { select: { siloId: true } } } });
		if (participant === null || participant.conversation.siloId !== command.siloId) return { status: ConversationProjectionReadStatuses.RevokedOrMissing, rows: [] };

		// 3. Read and project only canonical run events within the durable participant bounds.
		const afterPosition = command.cursor === null ? BigInt(participant.visibleFromPosition) - 1n : BigInt(command.cursor.position);
		if (afterPosition < BigInt(participant.visibleFromPosition) - 1n) return { status: ConversationProjectionReadStatuses.RevokedOrMissing, rows: [] };
		const position = command.cursor?.subframe === undefined ? { gt: afterPosition } : { gte: afterPosition };
		const boundedPosition = participant.accessEndedPosition === null ? position : { ...position, lte: participant.accessEndedPosition };
		const entries = await this.prisma.conversationTimelineEntry.findMany({
			where: {
				conversationId: command.conversationId,
				position: boundedPosition,
				kind: { in: [ConversationTimelineEntryKind.RunEvent, ConversationTimelineEntryKind.Message] },
			},
			include: { runEvent: true, message: true },
			orderBy: { position: "asc" },
			take: command.limit,
		});
		const rows = entries.flatMap(function _Project(entry): readonly ConversationProjectionEventRow[]
		{
			const position = entry.position.toString(10);
			if (entry.message != null && entry.messageId != null)
			{
				return [{
					cursor: __EncodeConversationProjectionCursor({ conversationId: command.conversationId, position }), conversationId: command.conversationId, position,
					runId: entry.message.runId, type: "conversation.message", payload: { messageId: entry.message.id, role: entry.message.role, state: entry.message.state, blocks: entry.message.blocks }, occurredAt: entry.occurredAt.toISOString(),
				}];
			}
			if (entry.runEvent === null || entry.runId === null) return [];
			return [{
				cursor: __EncodeConversationProjectionCursor({ conversationId: command.conversationId, position }),
				conversationId: command.conversationId,
				position,
				runId: entry.runId,
				type: entry.runEvent.type,
				payload: entry.runEvent.payload as Readonly<Record<string, unknown>>,
				occurredAt: entry.occurredAt.toISOString(),
			}];
		});
		return { status: ConversationProjectionReadStatuses.Authorized, rows };
	}
}
