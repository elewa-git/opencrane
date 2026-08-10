import { ConversationTimelineEntryKind } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

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

		const rows = await new PrismaConversationReplayRepository(prisma as never).read({ conversationId: "conversation-1", siloId: "silo-1", subjectId: "user-1", cursor: { conversationId: "conversation-1", position: "2" }, limit: 10 });

		expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { conversationId: "conversation-1", position: { gt: 2n }, kind: { in: [ConversationTimelineEntryKind.RunEvent, ConversationTimelineEntryKind.Message] } }, orderBy: { position: "asc" } }));
		expect(rows).toEqual([{ cursor: expect.stringMatching(/^c\./u), conversationId: "conversation-1", position: "3", runId: "run-1", type: "message.delta", payload: { messageId: "message-1", delta: "later" }, occurredAt: "2026-07-23T10:00:03.000Z" }]);
	});

	it("fails closed before persistence when a cursor belongs to another conversation", async function _RejectsForeignCursor()
	{
		const participant = vi.fn();
		const timeline = vi.fn();
		const rows = await new PrismaConversationReplayRepository({ conversationParticipant: { findUnique: participant }, conversationTimelineEntry: { findMany: timeline } } as never).read({ conversationId: "conversation-1", siloId: "silo-1", subjectId: "user-1", cursor: { conversationId: "foreign-conversation", position: "1" }, limit: 10 });

		expect(rows).toEqual([]);
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

		await expect(new PrismaConversationReplayRepository(prisma as never).read({ conversationId: "conversation-1", siloId: "silo-1", subjectId: "user-1", cursor: null, limit: 10 })).resolves.toEqual([]);
		expect(timeline).toHaveBeenCalledWith(expect.objectContaining({ where: { conversationId: "conversation-1", position: { gt: 0n, lte: 3n }, kind: { in: [ConversationTimelineEntryKind.RunEvent, ConversationTimelineEntryKind.Message] } } }));
	});

	it("returns no replay rows after organisation membership revocation", async function _RejectsRevokedMembership()
	{
		const participant = vi.fn();
		const timeline = vi.fn();
		const prisma = { orgMembership: { findFirst: vi.fn().mockResolvedValue(null) }, conversationParticipant: { findUnique: participant }, conversationTimelineEntry: { findMany: timeline } };

		await expect(new PrismaConversationReplayRepository(prisma as never).read({ conversationId: "conversation-1", siloId: "silo-1", subjectId: "user-1", cursor: null, limit: 10 })).resolves.toEqual([]);
		expect(participant).not.toHaveBeenCalled();
		expect(timeline).not.toHaveBeenCalled();
	});
});
