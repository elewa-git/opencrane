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

	it("allows approval suspension and rejects skipped or resurrected run states", function _agentRunTransitions()
	{
		expect(__IsAgentRunTransitionAllowed("accepted", "queued")).toBe(true);
		expect(__IsAgentRunTransitionAllowed("queued", "assigned")).toBe(true);
		expect(__IsAgentRunTransitionAllowed("assigned", "running")).toBe(true);
		expect(__IsAgentRunTransitionAllowed("running", "waiting_for_approval")).toBe(true);
		expect(__IsAgentRunTransitionAllowed("waiting_for_approval", "running")).toBe(true);
		expect(__IsAgentRunTransitionAllowed("running", "completed")).toBe(true);
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

	it("exposes durable steering outcomes with their causal message and successor identifiers", function _steeringRunEvents()
	{
		const queued: RunEvent = { runId: "run-1", sequence: 2, type: "steering.queued", payload: { messageId: "message-2" }, occurredAt: "2026-07-18T08:00:01.000Z" };
		const absorbed: RunEvent = { runId: "run-1", sequence: 3, type: "steering.absorbed", payload: { messageId: "message-2" }, occurredAt: "2026-07-18T08:00:02.000Z" };
		const deferred: RunEvent = { runId: "run-1", sequence: 4, type: "steering.deferred", payload: { messageId: "message-3", successorRunId: "run-2" }, occurredAt: "2026-07-18T08:00:03.000Z" };
		// @ts-expect-error Deferred steering must identify the run that now owns the message.
		const invalidDeferred: RunEvent = { runId: "run-1", sequence: 5, type: "steering.deferred", payload: { messageId: "message-4" }, occurredAt: "2026-07-18T08:00:04.000Z" };

		expect(queued.payload.messageId).toBe("message-2");
		expect(absorbed.payload.messageId).toBe("message-2");
		expect(deferred.payload.successorRunId).toBe("run-2");
		expect(invalidDeferred).toBeDefined();
	});
});
