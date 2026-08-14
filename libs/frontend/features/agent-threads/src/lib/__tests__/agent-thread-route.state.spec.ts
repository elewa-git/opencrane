import { describe, expect, it } from "vitest";

import { _AgentThreadHistoryAfterPurge, _PurgedAgentThreadRouteProjection } from "../agent-thread-route.state";

describe("Agent-thread route projection purge", function _AgentThreadRouteProjectionPurge()
{
	it("clears every child projection composed outside the feature store", function _PurgesEveryProjection()
	{
		expect(_PurgedAgentThreadRouteProjection()).toEqual({ activityRows: [], elicitation: null, asset: null, a2uiSurface: null, focusTarget: null });
	});

	it("removes the retained focus target while preserving router and parent restoration state", function _PurgesHistoryTarget()
	{
		const parentRestore = { parentConversationId: "group-launch", parentMessageId: "root-ask", parentScrollAnchor: "message-root-top" };
		expect(_AgentThreadHistoryAfterPurge({ navigationId: 41, parentRestore, focusTarget: { kind: "waiting-request", id: "delivery:delivery-1" } })).toEqual({ navigationId: 41, parentRestore });
		expect(_AgentThreadHistoryAfterPurge(null)).toEqual({});
	});
});
