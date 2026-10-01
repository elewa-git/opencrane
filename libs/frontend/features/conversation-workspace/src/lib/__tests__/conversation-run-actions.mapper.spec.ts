import { describe, expect, it } from "vitest";

import type { ConversationPersonalRun } from "@opencrane/state/conversation/workspace";

import { _ConversationRunActions } from "../conversation-run-actions.mapper";

/** Create one current personal work projection. */
function _Run(state: ConversationPersonalRun["state"]): ConversationPersonalRun
{
	return { runId: "run-1", conversationId: "conversation-1", state, attempt: 1, agentRevisionId: "revision-1", acceptedAt: "2026-09-11T08:00:00.000Z", latestTool: null, finishedAt: state === "cancelled" ? "2026-09-11T08:01:00.000Z" : null };
}

describe("conversation current work presentation", function _Suite()
{
	it.each(["accepted", "running", "waiting_for_input", "recovery_required"] as const)("offers Stop for active %s work", function _Active(state)
	{
		expect(_ConversationRunActions(_Run(state), false, false, null)?.canStop).toBe(true);
	});

	it("keeps an admitted Stop pending until authority changes state", function _Pending()
	{
		expect(_ConversationRunActions(_Run("running"), true, true, null)).toEqual({ statusLabel: "Stop requested", detail: "Waiting for OpenCrane to confirm the current work state.", canStop: true, busy: true, error: null });
	});

	it.each(["queued", "assigned", "cancelling", "cancelled", "completed", "failed"] as const)("renders terminal or settling %s work without Stop", function _Settled(state)
	{
		const presentation = _ConversationRunActions(_Run(state), false, false, null);
		expect(presentation?.canStop).toBe(false);
		expect(presentation?.statusLabel.length).toBeGreaterThan(0);
	});

	it("retains an ambiguous failure with an explicit retry control", function _Ambiguous()
	{
		const presentation = _ConversationRunActions(_Run("running"), true, false, "Stop could not be confirmed.");
		expect(presentation).toMatchObject({ canStop: true, busy: false, error: "Stop could not be confirmed." });
	});
});
