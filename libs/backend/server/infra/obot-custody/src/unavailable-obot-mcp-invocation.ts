import { __AssertToolAllowed, ObotMcpInvocationUnavailableError } from "./obot-mcp-invocation.js";
import type { ObotMcpInvocationPort, ObotMcpToolInvocationCommand, ObotMcpToolResult } from "./obot-mcp-invocation.types.js";

/**
 * MCP-invocation adapter used when this process has no Obot MCP transport configured.
 *
 * It still checks the allow-list FIRST — a tool the revision does not allow is refused with
 * `ObotMcpToolNotAllowedError`, even though nothing could have been invoked anyway — and only then
 * refuses the call with {@link ObotMcpInvocationUnavailableError} instead of inventing a tool
 * result. That order is what keeps the allow-list rule true of every implementation of the port; it
 * is asserted by __tests__/obot-mcp-invocation.test.ts.
 *
 * Called by: apps/opencrane/src/infra/obot/obot-adapters.factory.ts when no Obot configuration is
 * present; also used as a stand-in by tests in libs/backend/agents/execution/protocol.
 */
export class __UnavailableObotMcpInvocationAdapter implements ObotMcpInvocationPort
{
	/**
	 * Checks the allow-list, then always throws because there is no transport.
	 *
	 * @param command - The invocation to check.
	 * @throws ObotMcpToolNotAllowedError When the tool is not in `command.allowedToolNames`.
	 * @throws {ObotMcpInvocationUnavailableError} For every tool that IS allow-listed.
	 */
	async invokeTool(command: ObotMcpToolInvocationCommand): Promise<ObotMcpToolResult>
	{
		__AssertToolAllowed(command);
		throw new ObotMcpInvocationUnavailableError();
	}
}
