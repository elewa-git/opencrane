import { describe, expect, it } from "vitest";

import { __CanAppendRunEvent, __IsAgentRevisionTransitionAllowed, __IsAgentRunTransitionAllowed, __IsAgentServiceTransitionAllowed, __IsMessageTransitionAllowed, __IsThreadTransitionAllowed } from "../index.js";
import type { RunEvent } from "../index.js";

/** Creates a minimal immutable event for append-order tests. */
function _Event(runId: string, sequence: number): RunEvent
{
	return { runId, sequence, type: "run.started", payload: {}, occurredAt: "2026-07-18T08:00:00.000Z" };
}

describe("agent model state transitions", function _stateTransitionSuite()
{
	it("allows only declared agent-service lifecycle moves", function _agentServiceTransitions()
	{
		expect(__IsAgentServiceTransitionAllowed("draft", "active")).toBe(true);
		expect(__IsAgentServiceTransitionAllowed("active", "paused")).toBe(true);
		expect(__IsAgentServiceTransitionAllowed("paused", "active")).toBe(true);
		expect(__IsAgentServiceTransitionAllowed("active", "retired")).toBe(true);
		expect(__IsAgentServiceTransitionAllowed("draft", "paused")).toBe(false);
		expect(__IsAgentServiceTransitionAllowed("retired", "active")).toBe(false);
		expect(__IsAgentServiceTransitionAllowed("active", "active")).toBe(false);
	});

	it("keeps published agent revisions immutable and terminal revisions closed", function _agentRevisionTransitions()
	{
		expect(__IsAgentRevisionTransitionAllowed("draft", "published")).toBe(true);
		expect(__IsAgentRevisionTransitionAllowed("draft", "rejected")).toBe(true);
		expect(__IsAgentRevisionTransitionAllowed("published", "retired")).toBe(true);
		expect(__IsAgentRevisionTransitionAllowed("published", "draft")).toBe(false);
		expect(__IsAgentRevisionTransitionAllowed("rejected", "published")).toBe(false);
		expect(__IsAgentRevisionTransitionAllowed("retired", "published")).toBe(false);
	});

	it("requires active runs to pass through cancelling before cancellation becomes terminal", function _agentRunTransitions()
	{
		expect(__IsAgentRunTransitionAllowed("accepted", "queued")).toBe(true);
		expect(__IsAgentRunTransitionAllowed("queued", "assigned")).toBe(true);
		expect(__IsAgentRunTransitionAllowed("assigned", "running")).toBe(true);
		expect(__IsAgentRunTransitionAllowed("running", "waiting_for_approval")).toBe(true);
		expect(__IsAgentRunTransitionAllowed("waiting_for_approval", "running")).toBe(true);
		expect(__IsAgentRunTransitionAllowed("running", "completed")).toBe(true);
		expect(__IsAgentRunTransitionAllowed("accepted", "cancelling")).toBe(true);
		expect(__IsAgentRunTransitionAllowed("queued", "cancelling")).toBe(true);
		expect(__IsAgentRunTransitionAllowed("assigned", "cancelling")).toBe(true);
		expect(__IsAgentRunTransitionAllowed("running", "cancelling")).toBe(true);
		expect(__IsAgentRunTransitionAllowed("waiting_for_approval", "cancelling")).toBe(true);
		expect(__IsAgentRunTransitionAllowed("cancelling", "cancelled")).toBe(true);
		expect(__IsAgentRunTransitionAllowed("accepted", "cancelled")).toBe(false);
		expect(__IsAgentRunTransitionAllowed("queued", "cancelled")).toBe(false);
		expect(__IsAgentRunTransitionAllowed("assigned", "cancelled")).toBe(false);
		expect(__IsAgentRunTransitionAllowed("running", "cancelled")).toBe(false);
		expect(__IsAgentRunTransitionAllowed("waiting_for_approval", "cancelled")).toBe(false);
		expect(__IsAgentRunTransitionAllowed("cancelling", "failed")).toBe(false);
		expect(__IsAgentRunTransitionAllowed("cancelling", "running")).toBe(false);
		expect(__IsAgentRunTransitionAllowed("accepted", "running")).toBe(false);
		expect(__IsAgentRunTransitionAllowed("waiting_for_approval", "completed")).toBe(false);
		expect(__IsAgentRunTransitionAllowed("completed", "running")).toBe(false);
		expect(__IsAgentRunTransitionAllowed("failed", "queued")).toBe(false);
		expect(__IsAgentRunTransitionAllowed("cancelled", "running")).toBe(false);
	});

	it("models thread reopening without permitting message resurrection", function _transcriptTransitions()
	{
		expect(__IsThreadTransitionAllowed("active", "archived")).toBe(true);
		expect(__IsThreadTransitionAllowed("archived", "active")).toBe(true);
		expect(__IsThreadTransitionAllowed("active", "active")).toBe(false);
		expect(__IsMessageTransitionAllowed("pending", "streaming")).toBe(true);
		expect(__IsMessageTransitionAllowed("pending", "completed")).toBe(true);
		expect(__IsMessageTransitionAllowed("streaming", "completed")).toBe(true);
		expect(__IsMessageTransitionAllowed("streaming", "failed")).toBe(true);
		expect(__IsMessageTransitionAllowed("completed", "streaming")).toBe(false);
		expect(__IsMessageTransitionAllowed("failed", "completed")).toBe(false);
	});

	it("requires one-based contiguous same-run event sequences", function _runEventOrdering()
	{
		expect(__CanAppendRunEvent(null, _Event("run-1", 1))).toBe(true);
		expect(__CanAppendRunEvent(null, _Event("run-1", 0))).toBe(false);
		expect(__CanAppendRunEvent(null, _Event("run-1", 2))).toBe(false);
		expect(__CanAppendRunEvent(_Event("run-1", 1), _Event("run-1", 2))).toBe(true);
		expect(__CanAppendRunEvent(_Event("run-1", 1), _Event("run-1", 3))).toBe(false);
		expect(__CanAppendRunEvent(_Event("run-1", 1), _Event("run-2", 2))).toBe(false);
		expect(__CanAppendRunEvent(_Event("run-1", 1), _Event("run-1", 1.5))).toBe(false);
	});
});
