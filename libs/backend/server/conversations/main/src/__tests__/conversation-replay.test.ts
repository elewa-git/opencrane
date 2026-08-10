import { describe, expect, it } from "vitest";

import { __ReadConversationReplay } from "../conversation-replay.js";

describe("canonical conversation replay", function _Suite()
{
	it("bounds and redacts repository rows", async function _BoundsAndRedacts()
	{
		const repository = { read: async function _read() { return [
			{ cursor: "c.one", conversationId: "conversation-1", runId: "run-1", position: "1", type: "message.delta", payload: { messageId: "message-1", delta: "hello", proof: "secret" }, occurredAt: "2026-07-23T10:00:00.000Z" },
			{ cursor: "c.two", conversationId: "conversation-1", runId: "run-1", position: "2", type: "run.usage", payload: { providerToken: "secret" }, occurredAt: "2026-07-23T10:00:01.000Z" },
		]; } };
		const events = await __ReadConversationReplay(repository, { conversationId: "conversation-1", siloId: "silo-1", subjectId: "user-1", cursor: null, limit: 1 });
		expect(events).toHaveLength(1);
		expect(events[0]?.payload).toEqual({ messageId: "message-1", delta: "hello" });
	});

	it("refuses an invalid read bound before persistence", async function _RefusesInvalid()
	{
		let called = false;
		const events = await __ReadConversationReplay({ read: async function _read() { called = true; return []; } }, { conversationId: "conversation-1", siloId: "silo-1", subjectId: "user-1", cursor: null, limit: 501 });
		expect(events).toEqual([]);
		expect(called).toBe(false);
	});
});
