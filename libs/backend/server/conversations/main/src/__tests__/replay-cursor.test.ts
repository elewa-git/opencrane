import { describe, expect, it } from "vitest";

import { __DecodeConversationReplayCursor, __EncodeConversationReplayCursor } from "../replay-cursor.js";

describe("conversation timeline cursor", function _Suite()
{
	it("round trips the full canonical replay tuple", function _RoundTrips()
	{
		const cursor = { conversationId: "conversation-1", position: "4" };
		expect(__DecodeConversationReplayCursor(__EncodeConversationReplayCursor(cursor))).toEqual(cursor);
	});

	it("rejects malformed, incomplete, and invalid position input", function _Rejects()
	{
		expect(__DecodeConversationReplayCursor(["c.", "tampered"])).toBeNull();
		expect(__DecodeConversationReplayCursor({ cursor: "c.tampered" })).toBeNull();
		expect(__DecodeConversationReplayCursor("wrong")).toBeNull();
		expect(__DecodeConversationReplayCursor("c.eyJjb252ZXJzYXRpb25JZCI6ImNvbnZlcnNhdGlvbi0xIn0")).toBeNull();
		expect(__DecodeConversationReplayCursor(`c.${Buffer.from("[]").toString("base64url")}`)).toBeNull();
		expect(__DecodeConversationReplayCursor(__EncodeConversationReplayCursor({ conversationId: "conversation-1", position: "0" }))).toBeNull();
	});
});
