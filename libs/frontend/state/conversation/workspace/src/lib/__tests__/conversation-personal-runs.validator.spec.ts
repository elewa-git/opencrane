import { describe, expect, it } from "vitest";

import { _ParseConversationPersonalRuns } from "../conversation-personal-runs.validator";

const _RUN = { runId: "run", attempt: 1, state: "completed", conversationId: "chat", agentRevisionId: "revision", acceptedAt: "2026-09-08T12:00:00Z", latestTool: { phase: "result_received" }, finishedAt: "2026-09-08T12:00:01Z" };

describe("personal run response validator", function _Suite()
{
	it.each(["cancelling", "cancelled"])("accepts the authoritative %s lifecycle", function _CancellationState(state)
	{
		expect(_ParseConversationPersonalRuns({ runs: [{ ..._RUN, state, finishedAt: state === "cancelled" ? "2026-09-08T12:00:02Z" : null }] })[0]?.state).toBe(state);
	});

	it.each([
		{ latestTool: { phase: "running", result: "private result" } },
		{ latestTool: { phase: "unknown" } },
		{ latestTool: { phase: "running", invocationId: "private-id" } },
	])("rejects private or unknown tool progress fields %j", function _Rejects(patch)
	{
		expect(() => _ParseConversationPersonalRuns({ runs: [{ ..._RUN, ...patch }] })).toThrow();
	});
});
