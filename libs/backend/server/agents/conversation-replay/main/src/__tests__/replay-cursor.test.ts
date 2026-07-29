import { describe, expect, it } from "vitest";

import { __DecodeConversationReplayCursor, __EncodeConversationReplayCursor } from "../replay-cursor.js";

describe("conversation replay cursor", function _Suite()
{
	it("round trips the full canonical replay tuple", function _RoundTrips()
	{
		const cursor = { acceptedAt: "2026-07-23T10:00:00.000Z", runId: "run-1", sequence: 4 };
		expect(__DecodeConversationReplayCursor(__EncodeConversationReplayCursor(cursor))).toEqual(cursor);
	});

	it("rejects malformed, incomplete, and invalid sequence input", function _Rejects()
	{
		expect(__DecodeConversationReplayCursor(["e.", "tampered"])).toBeNull();
		expect(__DecodeConversationReplayCursor({ cursor: "e.tampered" })).toBeNull();
		expect(__DecodeConversationReplayCursor("wrong")).toBeNull();
		expect(__DecodeConversationReplayCursor("e.eyJydW5JZCI6InJ1bi0xIn0")).toBeNull();
		expect(__DecodeConversationReplayCursor(`e.${Buffer.from("[]").toString("base64url")}`)).toBeNull();
		expect(__DecodeConversationReplayCursor(__EncodeConversationReplayCursor({ acceptedAt: "2026-07-23T10:00:00.000Z", runId: "run-1", sequence: 0 }))).toBeNull();
	});
});
