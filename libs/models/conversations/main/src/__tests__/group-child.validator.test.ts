import { describe, expect, it } from "vitest";

import { GroupChildStates } from "../group-child.types";
import { ___ParseGroupChildOrigin, ___ParseGroupChildView } from "../group-child.validator";

/** Supplies the server's public creation progress without authority or runtime metadata. */
const _CHILD = { conversationId: "child", parentConversationId: "group", parentMessageId: "57de859d-1fb6-4782-aa0b-2b3d4dfd2292", parentMessagePosition: "2", state: GroupChildStates.Pending, agentName: "Research assistant" };

describe("group child public projections", function _Describe()
{
	it.each(Object.values(GroupChildStates))("accepts the %s creation state without implying work completed", function _State(state)
	{
		expect(___ParseGroupChildView({ ..._CHILD, state }).state).toBe(state);
	});
	it.each(["0", "-1", "01", "18446744073709551616", "1.2", "not-a-position"])("rejects source revision %s", function _Position(parentMessagePosition)
	{
		expect(function _Parse() { ___ParseGroupChildView({ ..._CHILD, parentMessagePosition }); }).toThrow();
	});
	it("rejects self-parenting, unknown state, and extra private fields", function _Rejects()
	{
		for (const extra of [{ conversationId: "group" }, { state: "completed" }, { principalId: "private" }])
			expect(function _Parse() { ___ParseGroupChildView({ ..._CHILD, ...extra }); }).toThrow();
	});
	it("preserves the full uint64 revision in a strict origin", function _Origin()
	{
		const origin = { requestId: _CHILD.parentMessageId, parentConversationId: "group", parentMessageId: _CHILD.parentMessageId, parentMessagePosition: "18446744073709551615" };
		expect(___ParseGroupChildOrigin(origin)).toEqual(origin);
		expect(function _Parse() { ___ParseGroupChildOrigin({ ...origin, secret: true }); }).toThrow();
	});
});
