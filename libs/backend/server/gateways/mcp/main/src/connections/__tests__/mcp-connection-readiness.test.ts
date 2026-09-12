import { describe, expect, it } from "vitest";

import { _McpConnectionOwnerPrincipalId } from "../mcp-connection-readiness";

describe("MCP connection owner", function _Suite()
{
	it("uses the caller Principal for a task-owned invocation", function _TaskOwner()
	{
		const invocation = { mcpTaskId: "task-1", runId: null, authorizationEvidence: { principalId: "human-1" } };
		expect(_McpConnectionOwnerPrincipalId(invocation as never)).toBe("human-1");
	});

	it("uses the execution subject rather than the requester for a managed run", function _RunOwner()
	{
		const invocation = { mcpTaskId: null, runId: "run-1", authorizationEvidence: { executionSubject: { principalId: "service-1" }, requester: { requesterPrincipalId: "admin-1" } } };
		expect(_McpConnectionOwnerPrincipalId(invocation as never)).toBe("service-1");
	});

	it.each([
		{ mcpTaskId: "task-1", runId: null, authorizationEvidence: null },
		{ mcpTaskId: "task-1", runId: null, authorizationEvidence: { executionSubject: { principalId: "service-1" } } },
		{ mcpTaskId: null, runId: "run-1", authorizationEvidence: { principalId: "human-1" } },
	])("rejects missing or owner-inconsistent evidence", function _Rejects(evidence)
	{
		expect(_McpConnectionOwnerPrincipalId(evidence as never)).toBeNull();
	});
});
