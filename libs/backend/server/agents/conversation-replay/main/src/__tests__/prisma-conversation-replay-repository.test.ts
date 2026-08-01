import { describe, expect, it, vi } from "vitest";

import { _CreateConversationReplayRepository } from "../prisma-conversation-replay-repository.js";

describe("Prisma conversation replay repository", function _Suite()
{
	it("retains the cursor run so later sequences can resume", async function _ResumesSameRun()
	{
		const findMany = vi.fn(async function _events() { return [{ runId: "run-1", sequence: 3, type: "message.delta", payload: { delta: "later" }, occurredAt: new Date("2026-07-23T10:00:03.000Z") }]; });
		const agentRunFindMany = vi.fn(async function _runs() { return [{ id: "run-1", acceptedAt: new Date("2026-07-23T10:00:00.000Z") }]; });
		const prisma = {
			conversationThread: { findUnique: async function _thread() { return { siloId: "silo-1", participants: [{ userId: "user-1" }] }; } },
			agentRun: { findFirst: async function _cursorRun() { return { id: "run-1" }; }, findMany: agentRunFindMany },
			conversationRunEvent: { findUnique: async function _cursorEvent() { return { runId: "run-1" }; }, findMany },
		};
		const repository = _CreateConversationReplayRepository(prisma as never);
		const rows = await repository.read({ threadId: "thread-1", siloId: "silo-1", subjectId: "user-1", cursor: { acceptedAt: "2026-07-23T10:00:00.000Z", runId: "run-1", sequence: 2 }, limit: 10 });
		expect(rows).toHaveLength(1);
		expect(agentRunFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ OR: expect.arrayContaining([expect.objectContaining({ acceptedAt: new Date("2026-07-23T10:00:00.000Z"), id: { gte: "run-1" } })]) }) }));
	});

	it("fails closed when a cursor belongs to another thread", async function _RejectsForeignCursor()
	{
		const findMany = vi.fn(async function _runs() { return []; });
		const prisma = {
			conversationThread: { findUnique: async function _thread() { return { siloId: "silo-1", participants: [{ userId: "user-1" }] }; } },
			agentRun: { findFirst: async function _cursorRun() { return null; }, findMany },
			conversationRunEvent: { findUnique: async function _cursorEvent() { return null; }, findMany: async function _events() { return []; } },
		};
		const rows = await _CreateConversationReplayRepository(prisma as never).read({ threadId: "thread-1", siloId: "silo-1", subjectId: "user-1", cursor: { acceptedAt: "2026-07-23T10:00:00.000Z", runId: "foreign-run", sequence: 1 }, limit: 10 });
		expect(rows).toEqual([]);
		expect(findMany).not.toHaveBeenCalled();
	});
});
