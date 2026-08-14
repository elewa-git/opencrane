import { ConversationTimelineEntryKind, OrgMemberStatus, type Prisma } from "@prisma/client";
import { __EncodeConversationProjectionCursor, ConversationProjectionReadStatuses, type ConversationProjectionEventRow, type ConversationProjectionReadResult, type ReadConversationProjectionCommand } from "@opencrane/backend/conversations/projection";
import { AgentThreadEventTypes } from "@opencrane/backend/conversations/agent-threads";
import { ConversationSystemEventTypes } from "@opencrane/models/conversations";

import type { ConversationReplayRepository } from "./replay-reader.types.js";

/**
 * The SQL side of a replay page: checks access, then reads rows in timeline order.
 *
 * Access is proved by two rows, not by anything the caller sent — an active organisation
 * membership in the requested silo, and a participant row on a conversation in that same silo.
 * The participant row also carries the range the caller may read, and that range is applied as
 * a WHERE bound rather than filtered afterwards, so rows outside it never leave the database.
 *
 * Takes a `Prisma.TransactionClient`, so it cannot open its own transaction; the caller owns
 * that.
 *
 * Called by: `PrismaConversationReplayUnitOfWork.readAuthorized`
 * (prisma-conversation-replay-unit-of-work.ts).
 */
export class PrismaConversationReplayRepository implements ConversationReplayRepository
{
	/** Transaction-scoped canonical product database snapshot. */
	private readonly prisma: Prisma.TransactionClient;

	/** Creates the read-only replay adapter inside its owning replay transaction. */
	constructor(prisma: Prisma.TransactionClient)
	{
		this.prisma = prisma;
	}

	/**
	 * @returns The access decision and up to `limit` rows in ascending position order. An
	 *   authorized result with no rows means "nothing new yet"; a revoked result means stop.
	 * @throws Whatever the database driver throws; the caller's transaction rolls back.
	 */
	async readAuthorized(command: ReadConversationProjectionCommand): Promise<ConversationProjectionReadResult>
	{
		// 1. Reject a foreign cursor before consulting any durable authority.
		if (command.cursor !== null && command.cursor.conversationId !== command.conversationId) return { status: ConversationProjectionReadStatuses.RevokedOrMissing, rows: [] };

		// 2. Prove access twice: an active membership in this silo, and a participant row on a conversation in the same silo. Both read in this transaction, so they agree with the rows below.
		const membership = await this.prisma.orgMembership.findFirst({ where: { clusterTenant: command.siloId, subject: command.subjectId, status: OrgMemberStatus.Active }, select: { clusterTenant: true } });
		if (membership === null) return { status: ConversationProjectionReadStatuses.RevokedOrMissing, rows: [] };
		const participant = await this.prisma.conversationParticipant.findFirst({ where: { conversationId: command.conversationId, userId: command.subjectId, conversation: _ConversationAccess(command) }, include: { conversation: { select: { siloId: true } } } });
		if (participant === null || participant.conversation.siloId !== command.siloId) return { status: ConversationProjectionReadStatuses.RevokedOrMissing, rows: [] };

		// 3. Read only rows inside the caller's visible range: start after the cursor (or at the range start), and stop at accessEndedPosition when their access has ended.
		const afterPosition = command.cursor === null ? BigInt(participant.visibleFromPosition) - 1n : BigInt(command.cursor.position);
		if (afterPosition < BigInt(participant.visibleFromPosition) - 1n) return { status: ConversationProjectionReadStatuses.RevokedOrMissing, rows: [] };
		const position = command.cursor?.subframe === undefined ? { gt: afterPosition } : { gte: afterPosition };
		const boundedPosition = participant.accessEndedPosition === null ? position : { ...position, lte: participant.accessEndedPosition };
		const entries = await this.prisma.conversationTimelineEntry.findMany({
			where: {
				conversationId: command.conversationId,
				position: boundedPosition,
				OR: [
					{ kind: { in: [ConversationTimelineEntryKind.RunEvent, ConversationTimelineEntryKind.Message] } },
					{ kind: ConversationTimelineEntryKind.ParentDelivery, parentDeliveryAgentThreadId: { not: null } },
					{ kind: ConversationTimelineEntryKind.System, payload: { equals: { eventType: ConversationSystemEventTypes.AssetsChanged } } },
				],
			},
			include: { runEvent: true, message: true, agentThreadDelivery: true },
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
			if (entry.kind === ConversationTimelineEntryKind.System && _AssetsChanged(entry.payload))
			{
				return [{ cursor: __EncodeConversationProjectionCursor({ conversationId: command.conversationId, position }), conversationId: command.conversationId, position, runId: null, type: ConversationSystemEventTypes.AssetsChanged, payload: {}, occurredAt: entry.occurredAt.toISOString() }];
			}
			if (entry.agentThreadDelivery != null)
			{
				const delivery = entry.agentThreadDelivery;
				return [{ cursor: __EncodeConversationProjectionCursor({ conversationId: command.conversationId, position }), conversationId: command.conversationId, position, runId: delivery.runId, type: AgentThreadEventTypes.ParentDelivery, payload: { id: delivery.id, childConversationId: delivery.childConversationId, kind: delivery.kind, label: delivery.label, detail: delivery.detail, assetId: delivery.assetId }, occurredAt: entry.occurredAt.toISOString() }];
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

/** Require a child Agent-thread reader to retain active access to its immediate parent. */
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

/** Admit only the exact payload-free asset-list invalidation marker. */
function _AssetsChanged(value: Prisma.JsonValue | null): boolean
{
	return value !== null && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 1 && value["eventType"] === ConversationSystemEventTypes.AssetsChanged;
}
