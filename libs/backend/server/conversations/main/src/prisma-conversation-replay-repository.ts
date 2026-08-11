import { ConversationTimelineEntryKind, OrgMemberStatus, type Prisma } from "@prisma/client";

import { __EncodeConversationReplayCursor } from "./replay-cursor.js";
import type { ConversationReplayRepository, ReadConversationReplayCommand } from "./replay-reader.types.js";
import type { ConversationReplayEventRow } from "./replay-projection.types.js";

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

	/** Read a bounded snapshot through explicit participant, silo, conversation, and position fences. */
	async read(command: ReadConversationReplayCommand): Promise<readonly ConversationReplayEventRow[]>
	{
		// 1. Reject a foreign cursor before consulting any durable authority.
		if (command.cursor !== null && command.cursor.conversationId !== command.conversationId) return [];

		// 2. Require current organisation membership and participant bounds in this repeatable snapshot.
		const membership = await this.prisma.orgMembership.findFirst({ where: { clusterTenant: command.siloId, subject: command.subjectId, status: OrgMemberStatus.Active }, select: { clusterTenant: true } });
		if (membership === null) return [];
		const participant = await this.prisma.conversationParticipant.findUnique({ where: { conversationId_userId: { conversationId: command.conversationId, userId: command.subjectId } }, include: { conversation: { select: { siloId: true } } } });
		if (participant === null || participant.conversation.siloId !== command.siloId) return [];

		// 3. Read and project only canonical run events within the durable participant bounds.
		const afterPosition = command.cursor === null ? BigInt(participant.visibleFromPosition) - 1n : BigInt(command.cursor.position);
		if (afterPosition < BigInt(participant.visibleFromPosition) - 1n) return [];
		const entries = await this.prisma.conversationTimelineEntry.findMany({
			where: {
				conversationId: command.conversationId,
				position: { gt: afterPosition, ...(participant.accessEndedPosition === null ? {} : { lte: participant.accessEndedPosition }) },
				kind: ConversationTimelineEntryKind.RunEvent,
			},
			include: { runEvent: true },
			orderBy: { position: "asc" },
			take: command.limit,
		});
		return entries.flatMap(function _Project(entry): readonly ConversationReplayEventRow[]
		{
			if (entry.runEvent === null || entry.runId === null) return [];
			const position = entry.position.toString(10);
			return [{
				cursor: __EncodeConversationReplayCursor({ conversationId: command.conversationId, position }),
				conversationId: command.conversationId,
				position,
				runId: entry.runId,
				type: entry.runEvent.type,
				payload: entry.runEvent.payload as Readonly<Record<string, unknown>>,
				occurredAt: entry.occurredAt.toISOString(),
			}];
		});
	}
}
