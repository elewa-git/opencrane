import { describe, expect, it } from "vitest";

import { __ProjectConversationReplayEvent } from "../replay-projection.js";

describe("conversation replay projection", function _Suite()
{
	it("copies only display-safe message fields", function _Redacts()
	{
		const projected = __ProjectConversationReplayEvent({ cursor: "e.cursor", threadId: "thread-1", runId: "run-1", sequence: 1, type: "message.delta", payload: { messageId: "message-1", delta: "hello", capabilityProof: "secret", fence: 3 }, occurredAt: "2026-07-23T10:00:00.000Z" });
		expect(projected?.payload).toEqual({ messageId: "message-1", delta: "hello" });
	});

	it("drops unsupported payloads and invalid canonical rows", function _FailsClosed()
	{
		expect(__ProjectConversationReplayEvent({ cursor: "e.cursor", threadId: "thread-1", runId: "run-1", sequence: 1, type: "run.usage", payload: { providerKey: "secret" }, occurredAt: "2026-07-23T10:00:00.000Z" })?.payload).toEqual({});
		expect(__ProjectConversationReplayEvent({ cursor: "", threadId: "thread-1", runId: "run-1", sequence: 1, type: "run.started", payload: {}, occurredAt: "2026-07-23T10:00:00.000Z" })).toBeNull();
	});
});
