import { __AssertToolAllowed } from "./obot-mcp-invocation.js";
import type { ObotMcpInvocationPort, ObotMcpToolInvocationCommand, ObotMcpToolResult } from "./obot-mcp-invocation.types.js";

/**
 * In-memory Obot MCP transport double for tests and offline composition.
 *
 * It enforces the same allow-list guard as production (a tool outside the revision's assignment is
 * rejected before any "call"), records every accepted invocation, and returns a canned result. It
 * never receives or stores a credential — only the opaque custody reference — so it exercises the
 * allow-list and provenance paths without a live Obot.
 */
export class __FakeObotMcpInvocationAdapter implements ObotMcpInvocationPort
{
	/** Every allow-listed invocation this transport accepted, in order. */
	readonly invocations: ObotMcpToolInvocationCommand[] = [];

	/**
	 * Creates a fake transport returning a fixed canned result.
	 * @param cannedResult - Opaque result returned for every allow-listed invocation.
	 */
	constructor(private readonly cannedResult: ObotMcpToolResult = { content: { ok: true } }) {}

	/** Enforces the allow-list, records the call, and returns the canned result. */
	async invokeTool(command: ObotMcpToolInvocationCommand): Promise<ObotMcpToolResult>
	{
		__AssertToolAllowed(command);
		this.invocations.push(command);
		return this.cannedResult;
	}
}
