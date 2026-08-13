import type { JsonValue } from "@opencrane/util";

/**
 * One request to invoke an MCP tool through an Obot custody reference.
 *
 * The runtime never holds the underlying credential: it names only the OPAQUE `obotCustodyReference`
 * Obot minted, the tool, and the (already validated) arguments. `allowedToolNames` is the immutable
 * allow-list copied from the revision's `AgentRevisionIntegrationAssignment`; only a tool present in
 * it may be invoked.
 */
export interface ObotMcpToolInvocationCommand
{
	/** Silo that owns the integration and its custody reference. */
	readonly siloId: string;
	/** Product integration identity the tool belongs to. */
	readonly integrationId: string;
	/** Opaque custody reference minted by Obot; never a credential and never locally synthesized. */
	readonly obotCustodyReference: string;
	/** MCP tool name being invoked. */
	readonly toolName: string;
	/** Validated, bounded tool arguments. */
	readonly arguments: JsonValue;
	/** Tool names the frozen agent revision allows. The caller fills it from the assignment's tool definitions; an empty list rejects everything. */
	readonly allowedToolNames: readonly string[];
}

/**
 * What an MCP tool call returned, straight from Obot.
 *
 * OpenCrane does not interpret `content` — it is handed back to the agent run as-is. Check
 * {@link ObotMcpToolResult.isError} first: a tool that failed still returns normally here, so a
 * caller that ignores the flag will treat an error message as a successful answer.
 * libs/backend/agents/execution/protocol/src/integration-external-action-executor.ts throws
 * `IntegrationToolReturnedError` when the flag is set, which becomes the durable failure code
 * `RuntimeError`.
 */
export interface ObotMcpToolResult
{
	/** Result payload as returned by Obot; opaque to OpenCrane. */
	readonly content: JsonValue;
	/** True when the tool itself failed. The call and the transport both succeeded, so nothing threw — you must branch on this. */
	readonly isError: boolean;
}

/**
 * Calls one MCP tool through a custody reference that Obot holds the credential for.
 *
 * Every implementation MUST check `allowedToolNames` before it opens any transport, so a tool the
 * agent revision does not allow is refused even when the call would otherwise have worked. Both
 * shipped implementations do this by calling `__AssertToolAllowed` as their first statement: the
 * HTTP adapter in http-obot-mcp-invocation.ts and the fail-closed stub in
 * unavailable-obot-mcp-invocation.ts.
 *
 * Called by: libs/backend/agents/execution/protocol/src/integration-external-action-executor.ts,
 * through `ExternalActionExecutorDependencies.obotMcpInvocation`; composed in
 * apps/opencrane/src/infra/obot/obot-adapters.factory.ts and
 * apps/opencrane/src/app/external-action-composition.ts.
 *
 * @see https://modelcontextprotocol.io/specification/2025-06-18 - the MCP revision the HTTP adapter
 *   pins for `initialize` and `tools/call`.
 */
export interface ObotMcpInvocationPort
{
	/**
	 * Runs one allow-listed tool and returns whatever Obot answered.
	 *
	 * @param command - Custody reference, tool name, validated arguments, and the allow-list.
	 * @returns The tool's payload plus its failure flag. A set flag is a tool-level failure, not a
	 *   transport failure, so the caller must branch on it rather than assume success.
	 * @throws ObotMcpToolNotAllowedError When the tool is not in `allowedToolNames`; checked first, so
	 *   nothing was sent to Obot.
	 * @throws ObotMcpInvocationUnavailableError When no Obot transport is configured.
	 * @throws ObotMcpAuthenticationError When Obot rejects the server's own service token (401).
	 * @throws ObotMcpAuthorizationError When Obot refuses the server this MCP endpoint (403).
	 * @throws ObotProtocolError When the handshake, the pinned-revision echo, or the result is unusable.
	 * @throws ObotTransportError For any other transport failure.
	 */
	invokeTool(command: ObotMcpToolInvocationCommand): Promise<ObotMcpToolResult>;
}
