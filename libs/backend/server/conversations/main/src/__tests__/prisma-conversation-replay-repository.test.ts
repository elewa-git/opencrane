import { ConversationTimelineEntryKind } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { ConversationProjectionReadStatuses } from "@opencrane/backend/conversations/projection";

import { PrismaConversationReplayRepository } from "../prisma-conversation-replay-repository.js";

describe("Prisma conversation replay repository", function _Suite()
{
	it("reads participant-visible run events through canonical timeline positions", async function _ReadsTimeline()
	{
		const findMany = vi.fn().mockResolvedValue([{ conversationId: "conversation-1", position: 3n, kind: ConversationTimelineEntryKind.RunEvent, runId: "run-1", occurredAt: new Date("2026-07-23T10:00:03.000Z"), runEvent: { type: "message.delta", payload: { messageId: "message-1", delta: "later" } } }]);
		const prisma = {
			orgMembership: { findFirst: vi.fn().mockResolvedValue({ clusterTenant: "silo-1" }) },
			conversationParticipant: { findUnique: vi.fn().mockResolvedValue({ visibleFromPosition: 1n, accessEndedPosition: null, conversation: { siloId: "silo-1" } }) },
			conversationTimelineEntry: { findMany },
		};

		const result = await new PrismaConversationReplayRepository(prisma as never).readAuthorized({ conversationId: "conversation-1", siloId: "silo-1", subjectId: "user-1", cursor: { conversationId: "conversation-1", position: "2" }, limit: 10 });
		expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ conversationId: "conversation-1", position: { gt: 2n }, OR: expect.arrayContaining([{ kind: { in: [ConversationTimelineEntryKind.RunEvent, ConversationTimelineEntryKind.Message] } }, { kind: ConversationTimelineEntryKind.ParentDelivery, parentDeliveryAgentThreadId: { not: null } }]) }), orderBy: { position: "asc" } }));
		expect(result).toEqual({ status: ConversationProjectionReadStatuses.Authorized, rows: [{ cursor: expect.stringMatching(/^c\./u), conversationId: "conversation-1", position: "3", runId: "run-1", type: "message.delta", payload: { messageId: "message-1", delta: "later" }, occurredAt: "2026-07-23T10:00:03.000Z" }] });
	});

	it("fails closed before persistence when a cursor belongs to another conversation", async function _RejectsForeignCursor()
	{
		const participant = vi.fn();
		const timeline = vi.fn();
		const result = await new PrismaConversationReplayRepository({ conversationParticipant: { findUnique: participant }, conversationTimelineEntry: { findMany: timeline } } as never).readAuthorized({ conversationId: "conversation-1", siloId: "silo-1", subjectId: "user-1", cursor: { conversationId: "foreign-conversation", position: "1" }, limit: 10 });

		expect(result).toEqual({ status: ConversationProjectionReadStatuses.RevokedOrMissing, rows: [] });
		expect(participant).not.toHaveBeenCalled();
		expect(timeline).not.toHaveBeenCalled();
	});

	it("caps replay at the participant's last visible position after access ends", async function _CapsEndedAccess()
	{
		const timeline = vi.fn().mockResolvedValue([]);
		const prisma = {
			orgMembership: { findFirst: vi.fn().mockResolvedValue({ clusterTenant: "silo-1" }) },
			conversationParticipant: { findUnique: vi.fn().mockResolvedValue({ visibleFromPosition: 1n, accessEndedPosition: 3n, conversation: { siloId: "silo-1" } }) },
			conversationTimelineEntry: { findMany: timeline },
		};

		await expect(new PrismaConversationReplayRepository(prisma as never).readAuthorized({ conversationId: "conversation-1", siloId: "silo-1", subjectId: "user-1", cursor: null, limit: 10 })).resolves.toEqual({ status: ConversationProjectionReadStatuses.Authorized, rows: [] });
		expect(timeline).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ conversationId: "conversation-1", position: { gt: 0n, lte: 3n }, OR: expect.arrayContaining([{ kind: ConversationTimelineEntryKind.ParentDelivery, parentDeliveryAgentThreadId: { not: null } }]) }) }));
	});

	it("projects only the exact asset-list System invalidation", async function _AssetInvalidation()
	{
		const findMany = vi.fn().mockResolvedValue([{ conversationId: "conversation-1", position: 4n, kind: ConversationTimelineEntryKind.System, runId: null, messageId: null, payload: { eventType: "conversation.assets.changed" }, occurredAt: new Date("2026-08-11T10:00:00.000Z"), runEvent: null, message: null }]);
		const prisma = { orgMembership: { findFirst: vi.fn().mockResolvedValue({ clusterTenant: "silo-1" }) }, conversationParticipant: { findUnique: vi.fn().mockResolvedValue({ visibleFromPosition: 1n, accessEndedPosition: null, conversation: { siloId: "silo-1" } }) }, conversationTimelineEntry: { findMany } };
		const result = await new PrismaConversationReplayRepository(prisma as never).readAuthorized({ conversationId: "conversation-1", siloId: "silo-1", subjectId: "user-1", cursor: null, limit: 10 });
		expect(result).toEqual({ status: ConversationProjectionReadStatuses.Authorized, rows: [{ cursor: expect.stringMatching(/^c\./u), conversationId: "conversation-1", position: "4", runId: null, type: "conversation.assets.changed", payload: {}, occurredAt: "2026-08-11T10:00:00.000Z" }] });
		expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ OR: expect.arrayContaining([{ kind: ConversationTimelineEntryKind.System, payload: { equals: { eventType: "conversation.assets.changed" } } }]) }) }));
	});

	it("lets the database skip unrelated System positions so later visible rows advance", async function _SkipsSystemGap()
	{
		const findMany = vi.fn().mockResolvedValueOnce([{ conversationId: "conversation-1", position: 6n, kind: ConversationTimelineEntryKind.RunEvent, runId: "run-1", messageId: null, payload: null, occurredAt: new Date("2026-08-11T10:00:02.000Z"), runEvent: { type: "message.completed", payload: { messageId: "message-1" } }, message: null }]).mockResolvedValueOnce([]);
		const prisma = { orgMembership: { findFirst: vi.fn().mockResolvedValue({ clusterTenant: "silo-1" }) }, conversationParticipant: { findUnique: vi.fn().mockResolvedValue({ visibleFromPosition: 1n, accessEndedPosition: null, conversation: { siloId: "silo-1" } }) }, conversationTimelineEntry: { findMany } };
		const repository = new PrismaConversationReplayRepository(prisma as never);
		const first = await repository.readAuthorized({ conversationId: "conversation-1", siloId: "silo-1", subjectId: "user-1", cursor: { conversationId: "conversation-1", position: "4" }, limit: 10 });
		const row = first.status === ConversationProjectionReadStatuses.Authorized ? first.rows[0] : undefined;
		if (row === undefined) throw new Error("visible row missing");
		await repository.readAuthorized({ conversationId: "conversation-1", siloId: "silo-1", subjectId: "user-1", cursor: { conversationId: "conversation-1", position: row.position }, limit: 10 });
		expect(findMany.mock.calls[0]?.[0]).toMatchObject({ where: { position: { gt: 4n } } });
		expect(findMany.mock.calls[1]?.[0]).toMatchObject({ where: { position: { gt: 6n } } });
	});

	it("returns no replay rows after organisation membership revocation", async function _RejectsRevokedMembership()
	{
		const participant = vi.fn();
		const timeline = vi.fn();
		const prisma = { orgMembership: { findFirst: vi.fn().mockResolvedValue(null) }, conversationParticipant: { findUnique: participant }, conversationTimelineEntry: { findMany: timeline } };

		await expect(new PrismaConversationReplayRepository(prisma as never).readAuthorized({ conversationId: "conversation-1", siloId: "silo-1", subjectId: "user-1", cursor: null, limit: 10 })).resolves.toEqual({ status: ConversationProjectionReadStatuses.RevokedOrMissing, rows: [] });
		expect(participant).not.toHaveBeenCalled();
		expect(timeline).not.toHaveBeenCalled();
	});
});
