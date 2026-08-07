import { __AssertToolAllowed, ObotMcpInvocationUnavailableError } from "./obot-mcp-invocation.js";
import type { ObotMcpInvocationPort, ObotMcpToolInvocationCommand, ObotMcpToolResult } from "./obot-mcp-invocation.types.js";

/**
 * Fail-closed MCP-invocation adapter used until an authenticated Obot MCP transport is verified.
 *
 * It still enforces the allow-list FIRST — a tool outside the revision's assignment is rejected with
 * {@link ObotMcpToolNotAllowedError} even while unavailable — then refuses every allow-listed call
 * rather than fabricating a tool result.
 */
export class __UnavailableObotMcpInvocationAdapter implements ObotMcpInvocationPort
{
	/** Enforces the allow-list, then refuses because no transport is configured. */
	async invokeTool(command: ObotMcpToolInvocationCommand): Promise<ObotMcpToolResult>
	{
		__AssertToolAllowed(command);
		throw new ObotMcpInvocationUnavailableError();
	}
}
