/** Placeholder replaced by the MCP database trigger with its millisecond database clock. */
export const _McpRuntimeTimestampProposal = new Date(0);

/** Preserve only the requested gap; the database trigger chooses the actual start time. */
export function _McpRuntimeLeaseExpiryProposal(leaseMilliseconds: number): Date
{
	return new Date(_McpRuntimeTimestampProposal.getTime() + leaseMilliseconds);
}
