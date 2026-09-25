import { McpConnectionFailureCodes, McpConnectionStatus, type McpConnectionProjection } from "@opencrane/contracts";

import { McpConnectionStates, type McpConnectionRecord } from "./mcp-connection.types";

const _STATUS: Readonly<Record<McpConnectionStates, McpConnectionStatus>> = {
	[McpConnectionStates.AwaitingMaterial]: McpConnectionStatus.Activating,
	[McpConnectionStates.Activating]: McpConnectionStatus.Activating,
	[McpConnectionStates.Active]: McpConnectionStatus.Active,
	[McpConnectionStates.RecoveryRequired]: McpConnectionStatus.RecoveryRequired,
	[McpConnectionStates.Failed]: McpConnectionStatus.NeedsCredential,
	[McpConnectionStates.Revoked]: McpConnectionStatus.NeedsCredential,
};

/** Project a connection row without exposing its identity, endpoint, evidence, or Secret coordinates. */
export function __ProjectMcpConnection(record: McpConnectionRecord): McpConnectionProjection
{
	if (record.failureCode !== null && !Object.values(McpConnectionFailureCodes).includes(record.failureCode))
		throw new Error("MCP connection has an unknown failure code.");
	return {
		connectionStatus: _STATUS[record.state],
		connectionGeneration: record.generation,
		credentialUpdatedAt: record.credentialCustodiedAt?.toISOString() ?? null,
		failureCode: record.failureCode,
	};
}
