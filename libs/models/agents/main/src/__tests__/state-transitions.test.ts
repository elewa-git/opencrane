import { describe, expect, it } from "vitest";

import { __IsAgentRevisionTransitionAllowed, __IsAgentRunTransitionAllowed, __IsAgentServiceTransitionAllowed } from "../index";

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
		expect(__IsAgentRunTransitionAllowed("running", "waiting_for_input")).toBe(true);
		expect(__IsAgentRunTransitionAllowed("waiting_for_input", "running")).toBe(true);
		expect(__IsAgentRunTransitionAllowed("running", "recovery_required")).toBe(true);
		expect(__IsAgentRunTransitionAllowed("recovery_required", "cancelling")).toBe(true);
		expect(__IsAgentRunTransitionAllowed("running", "completed")).toBe(true);
		expect(__IsAgentRunTransitionAllowed("accepted", "cancelling")).toBe(true);
		expect(__IsAgentRunTransitionAllowed("queued", "cancelling")).toBe(true);
		expect(__IsAgentRunTransitionAllowed("assigned", "cancelling")).toBe(true);
		expect(__IsAgentRunTransitionAllowed("running", "cancelling")).toBe(true);
		expect(__IsAgentRunTransitionAllowed("waiting_for_input", "cancelling")).toBe(true);
		expect(__IsAgentRunTransitionAllowed("cancelling", "cancelled")).toBe(true);
		expect(__IsAgentRunTransitionAllowed("accepted", "cancelled")).toBe(false);
		expect(__IsAgentRunTransitionAllowed("queued", "cancelled")).toBe(false);
		expect(__IsAgentRunTransitionAllowed("assigned", "cancelled")).toBe(false);
		expect(__IsAgentRunTransitionAllowed("running", "cancelled")).toBe(false);
		expect(__IsAgentRunTransitionAllowed("waiting_for_input", "cancelled")).toBe(false);
		expect(__IsAgentRunTransitionAllowed("cancelling", "failed")).toBe(false);
		expect(__IsAgentRunTransitionAllowed("cancelling", "running")).toBe(false);
		expect(__IsAgentRunTransitionAllowed("accepted", "running")).toBe(false);
		expect(__IsAgentRunTransitionAllowed("waiting_for_input", "completed")).toBe(false);
		expect(__IsAgentRunTransitionAllowed("completed", "running")).toBe(false);
		expect(__IsAgentRunTransitionAllowed("failed", "queued")).toBe(false);
		expect(__IsAgentRunTransitionAllowed("cancelled", "running")).toBe(false);
	});

});
