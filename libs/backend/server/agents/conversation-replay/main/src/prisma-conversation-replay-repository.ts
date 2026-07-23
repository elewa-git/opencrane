import type { PrismaClient } from "@prisma/client";

import { __EncodeConversationReplayCursor } from "./replay-cursor.js";
import type { ConversationReplayCursor } from "./replay-cursor.types.js";
import type { ConversationReplayRepository, ReadConversationReplayCommand } from "./replay-reader.types.js";
import type { ConversationReplayEventRow } from "./replay-projection.types.js";

/** Prisma adapter that reads only a consumed context's participant-bound canonical thread events. */
export class PrismaConversationReplayRepository implements ConversationReplayRepository
{
	/** Canonical product database. */
	private readonly prisma: PrismaClient;

	/** Creates the read-only replay adapter. */
	constructor(prisma: PrismaClient)
	{
		this.prisma = prisma;
	}

	/** Read a bounded snapshot through explicit participant, silo, thread, and keyset constraints. */
	async read(command: ReadConversationReplayCommand): Promise<readonly ConversationReplayEventRow[]>
	{
		const thread = await this.prisma.conversationThread.findUnique({ where: { id: command.threadId }, include: { participants: true } });
		if (thread === null || thread.siloId !== command.siloId || !thread.participants.some(participant => participant.userId === command.subjectId)) return [];
		const cursor = command.cursor;
		if (cursor !== null && !await this._cursorBelongsToThread(command, cursor)) return [];
		const runs = await this.prisma.agentRun.findMany({
			where: { threadId: command.threadId, siloId: command.siloId, ...(cursor ? { OR: [{ acceptedAt: { gt: new Date(cursor.acceptedAt) } }, { acceptedAt: new Date(cursor.acceptedAt), id: { gte: cursor.runId } }] } : {}) },
			select: { id: true, acceptedAt: true }, orderBy: [{ acceptedAt: "asc" }, { id: "asc" }], take: command.limit,
		});
		if (runs.length === 0) return [];
		const events = await this.prisma.conversationRunEvent.findMany({ where: { runId: { in: runs.map(run => run.id) } }, orderBy: [{ runId: "asc" }, { sequence: "asc" }] });
		const runOrder = new Map(runs.map((run, index) => [run.id, index]));
		return events.filter(event => cursor === null || event.runId !== cursor.runId || event.sequence > cursor.sequence).sort((left, right) => (runOrder.get(left.runId)! - runOrder.get(right.runId)!) || left.sequence - right.sequence).slice(0, command.limit).map(event => {
			const run = runs[runOrder.get(event.runId)!]!;
			return { cursor: __EncodeConversationReplayCursor({ acceptedAt: run.acceptedAt.toISOString(), runId: event.runId, sequence: event.sequence }), threadId: command.threadId, runId: event.runId, sequence: event.sequence, type: event.type, payload: event.payload as Record<string, unknown>, occurredAt: event.occurredAt.toISOString() };
		});
	}

	/** Confirm that a resume coordinate is a real immutable event in this authorised thread. */
	private async _cursorBelongsToThread(command: ReadConversationReplayCommand, cursor: ConversationReplayCursor): Promise<boolean>
	{
		const run = await this.prisma.agentRun.findFirst({ where: { id: cursor.runId, threadId: command.threadId, siloId: command.siloId, acceptedAt: new Date(cursor.acceptedAt) }, select: { id: true } });
		if (run === null) return false;
		const event = await this.prisma.conversationRunEvent.findUnique({ where: { runId_sequence: { runId: cursor.runId, sequence: cursor.sequence } }, select: { runId: true } });
		return event !== null;
	}
}
