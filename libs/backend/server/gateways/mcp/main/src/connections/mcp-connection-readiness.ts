import type { ToolInvocationRecord } from "@opencrane/backend/server/iam/authorization";

/** Failure saved when an installation cannot authorize an MCP effect before dispatch. */
export const _MCP_CONNECTION_UNAVAILABLE = "mcp_connection_unavailable";

/** Return the execution Principal from the evidence shape that owns this invocation. */
export function _McpConnectionOwnerPrincipalId(invocation: ToolInvocationRecord): string | null
{
	const evidence = invocation.authorizationEvidence;
	if (evidence === null)
		return null;
	if (invocation.mcpTaskId !== null)
	{
		if (!("principalId" in evidence))
			return null;
		return evidence.principalId.trim().length > 0 ? evidence.principalId : null;
	}
	if (invocation.runId === null || !("executionSubject" in evidence))
		return null;
	const principalId = evidence.executionSubject.principalId;
	return principalId.trim().length > 0 ? principalId : null;
}
