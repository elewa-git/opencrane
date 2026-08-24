import { describe, expect, it } from "vitest";

import { __McpEraProbeRequiredState, __McpEraProbeTransition, McpEraProbeActions, McpEraProbeEvents, McpEraProbeStates } from "../era-probe/mcp-era-probe-state";

describe("MCP era-probe state table", function _StateTableSuite()
{
	it("accepts, rejects, or retries only while the probe is pending", function _PendingTransitions()
	{
		expect(__McpEraProbeTransition(McpEraProbeStates.Pending, McpEraProbeEvents.ObservedAcceptedVersion)).toBe(McpEraProbeActions.Accept);
		expect(__McpEraProbeTransition(McpEraProbeStates.Pending, McpEraProbeEvents.ObservedOtherVersion)).toBe(McpEraProbeActions.Reject);
		expect(__McpEraProbeTransition(McpEraProbeStates.Pending, McpEraProbeEvents.TerminalFailure)).toBe(McpEraProbeActions.Reject);
		expect(__McpEraProbeTransition(McpEraProbeStates.Pending, McpEraProbeEvents.RetryableFailure)).toBe(McpEraProbeActions.Retry);
	});

	it("returns either completed winner without redispatching external work", function _CompletedReplay()
	{
		expect(__McpEraProbeTransition(McpEraProbeStates.Accepted, McpEraProbeEvents.Replay)).toBe(McpEraProbeActions.ReturnStored);
		expect(__McpEraProbeTransition(McpEraProbeStates.Rejected, McpEraProbeEvents.Replay)).toBe(McpEraProbeActions.ReturnStored);
	});

	it("permits approval and publication only after an accepted result", function _GovernanceTransitions()
	{
		expect(__McpEraProbeTransition(McpEraProbeStates.Accepted, McpEraProbeEvents.Approve)).toBe(McpEraProbeActions.Allow);
		expect(__McpEraProbeTransition(McpEraProbeStates.Accepted, McpEraProbeEvents.Publish)).toBe(McpEraProbeActions.Allow);
		expect(__McpEraProbeTransition(McpEraProbeStates.Pending, McpEraProbeEvents.Approve)).toBe(McpEraProbeActions.Deny);
		expect(__McpEraProbeTransition(McpEraProbeStates.Rejected, McpEraProbeEvents.Publish)).toBe(McpEraProbeActions.Deny);
		expect(__McpEraProbeRequiredState("Approved")).toBe(McpEraProbeStates.Accepted);
		expect(__McpEraProbeRequiredState("Published")).toBe(McpEraProbeStates.Accepted);
		expect(__McpEraProbeRequiredState("Disabled")).toBeUndefined();
	});
});
