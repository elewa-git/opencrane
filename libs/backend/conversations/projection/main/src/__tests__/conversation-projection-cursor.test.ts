import { describe, expect, it } from "vitest";

import { __DecodeConversationProjectionCursor, __EncodeConversationProjectionCursor } from "../conversation-projection-cursor.js";

describe("conversation timeline cursor", function _Suite()
{
	it("round trips the full canonical replay tuple", function _RoundTrips()
	{
		const cursor = { conversationId: "conversation-1", position: "4" };
		expect(__DecodeConversationProjectionCursor(__EncodeConversationProjectionCursor(cursor))).toEqual(cursor);
	});

	it("rejects malformed, incomplete, and invalid position input", function _Rejects()
	{
		expect(__DecodeConversationProjectionCursor(["c.", "tampered"])).toBeNull();
		expect(__DecodeConversationProjectionCursor({ cursor: "c.tampered" })).toBeNull();
		expect(__DecodeConversationProjectionCursor("wrong")).toBeNull();
		expect(__DecodeConversationProjectionCursor("c.eyJjb252ZXJzYXRpb25JZCI6ImNvbnZlcnNhdGlvbi0xIn0")).toBeNull();
		expect(__DecodeConversationProjectionCursor(`c.${Buffer.from("[]").toString("base64url")}`)).toBeNull();
		expect(__DecodeConversationProjectionCursor(__EncodeConversationProjectionCursor({ conversationId: "conversation-1", position: "0" }))).toBeNull();
	});
});
