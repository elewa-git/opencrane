import { describe, expect, it } from "vitest";

import { AgentThreadAccessStates, AgentThreadRecoveryStates, AgentThreadRunStates, AgentThreadSummaryStates, AgentThreadSummaryTargetKinds, AgentThreadTimelineEntryKinds, type AgentThreadSnapshot } from "@opencrane/state/conversation/agent-threads";

import { _AgentThreadAuthorizedFocusTarget } from "../agent-thread-focus-target.js";

/** Build the smallest authorized snapshot needed to validate route focus targets. */
function _Snapshot(): AgentThreadSnapshot
{
	return { parentConversationId: "parent", childConversationId: "child", origin: { parentTitle: "Group", parentMessageId: "root", invokedByName: "Alex", invokedByInitials: "AK", ask: "Compare", timestampLabel: "11:00" }, summary: { childConversationId: "child", state: AgentThreadSummaryStates.Working, access: AgentThreadAccessStates.Available, title: "Comparison", unreadCount: 0, participants: [], replyCount: 0, runCount: 1, updateCount: 1, lastUpdateLabel: "11:00", assetCount: 0, target: { kind: AgentThreadSummaryTargetKinds.Thread, id: "agent-thread-origin" } }, recovery: AgentThreadRecoveryStates.Live, timeline: [{ kind: AgentThreadTimelineEntryKinds.RunBoundary, id: "run:one", run: { runId: "one", ordinal: 1, state: AgentThreadRunStates.Working, label: "Run 1" } }], cursor: null, latestPosition: "1", representedThroughPosition: "1", canSendFollowUp: false };
}

describe("Agent-thread authorized focus target", function _AgentThreadAuthorizedFocusTargetTests()
{
	it("retains a history target found in the authorized snapshot", function _RetainsAuthorizedTarget()
	{
		const requested = { kind: AgentThreadSummaryTargetKinds.Failure, id: "run:one" };
		expect(_AgentThreadAuthorizedFocusTarget(requested, _Snapshot())).toBe(requested);
	});

	it("falls back when browser history names a target outside the snapshot", function _RejectsUnknownTarget()
	{
		expect(_AgentThreadAuthorizedFocusTarget({ kind: AgentThreadSummaryTargetKinds.FinalResult, id: "delivery:guessed" }, _Snapshot())).toEqual({ kind: AgentThreadSummaryTargetKinds.Thread, id: "agent-thread-origin" });
	});
});
