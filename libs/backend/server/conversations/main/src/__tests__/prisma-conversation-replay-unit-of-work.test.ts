import { Prisma, type PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { ConversationProjectionReadStatuses } from "@opencrane/backend/conversations/projection";

import { _CreateConversationReplayRepository } from "../db/prisma-conversation-replay.composition.js";

describe("Prisma conversation replay unit of work", function _Suite()
{
	it("keeps access bounds and timeline rows in one repeatable snapshot when access ends between reads", async function _KeepsOneSnapshot()
	{
		const visibleAtTransactionStart = [{ conversationId: "conversation-1", position: 2n, kind: "RUN_EVENT", runId: "run-1", occurredAt: new Date("2026-08-10T10:00:02.000Z"), runEvent: { type: "message.delta", payload: { messageId: "message-1", delta: "visible" } } }];
		const liveTimeline = [...visibleAtTransactionStart];
		let liveAccessEndedPosition: bigint | null = null;
		const transaction = {
			orgMembership: { findFirst: vi.fn().mockResolvedValue({ clusterTenant: "silo-1" }) },
			conversationParticipant: { findFirst: vi.fn(async function _ReadParticipant()
			{
				const snapshotAccessEndedPosition = liveAccessEndedPosition;
				liveAccessEndedPosition = 3n;
				liveTimeline.push({ conversationId: "conversation-1", position: 4n, kind: "RUN_EVENT", runId: "run-1", occurredAt: new Date("2026-08-10T10:00:04.000Z"), runEvent: { type: "message.delta", payload: { messageId: "message-1", delta: "must-not-leak" } } });
				return { visibleFromPosition: 1n, accessEndedPosition: snapshotAccessEndedPosition, conversation: { siloId: "silo-1" } };
			}) },
			conversationTimelineEntry: { findMany: vi.fn(async function _ReadSnapshot() { return visibleAtTransactionStart; }) },
		};
		const prisma = {
			$transaction: vi.fn(async function _Transaction(callback: (client: typeof transaction) => Promise<unknown>, options: { readonly isolationLevel: Prisma.TransactionIsolationLevel })
			{
				expect(options.isolationLevel).toBe(Prisma.TransactionIsolationLevel.RepeatableRead);
				return callback(transaction);
			}),
			conversationParticipant: { findFirst: vi.fn(function _RootParticipantRead() { throw new Error("root participant read"); }) },
			conversationTimelineEntry: { findMany: vi.fn(function _RootTimelineRead() { return liveTimeline; }) },
		} as unknown as PrismaClient;

		const result = await _CreateConversationReplayRepository(prisma).readAuthorized({ conversationId: "conversation-1", siloId: "silo-1", subjectId: "user-1", cursor: null, limit: 10 });

		expect(prisma.$transaction).toHaveBeenCalledTimes(1);
		expect(transaction.conversationParticipant.findFirst).toHaveBeenCalledTimes(1);
		expect(transaction.conversationTimelineEntry.findMany).toHaveBeenCalledTimes(1);
		expect(liveAccessEndedPosition).toBe(3n);
		expect(liveTimeline).toHaveLength(2);
		expect(result.status).toBe(ConversationProjectionReadStatuses.Authorized);
		expect(result.rows.map(function _Position(row): string { return row.position; })).toEqual(["2"]);
	});
});
