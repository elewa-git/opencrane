import type { ObotMcpToolInvocationCommand } from "./obot-mcp-invocation.types.js";

/** Typed failure raised when a tool outside the revision's allow-list is invoked. */
export class ObotMcpToolNotAllowedError extends Error
{
	/** Creates a fail-closed allow-list violation naming the rejected tool. */
	constructor(toolName: string)
	{
		super(`MCP tool is not in the revision allow-list: ${toolName}`);
		this.name = "ObotMcpToolNotAllowedError";
	}
}

/** Typed failure raised when no authenticated Obot MCP transport is configured. */
export class ObotMcpInvocationUnavailableError extends Error
{
	/** Creates a failure that cannot be mistaken for a successful invocation. */
	constructor()
	{
		super("Obot MCP invocation authority is unavailable");
		this.name = "ObotMcpInvocationUnavailableError";
	}
}

/**
 * Assert an invocation names an allow-listed tool, throwing {@link ObotMcpToolNotAllowedError}
 * otherwise. This is the single enforcement point every adapter calls before any transport, so the
 * allow-list is honoured even by the fail-closed stub.
 * @param command - The invocation to validate.
 */
export function __AssertToolAllowed(command: ObotMcpToolInvocationCommand): void
{
	if (!command.allowedTools.includes(command.toolName)) throw new ObotMcpToolNotAllowedError(command.toolName);
}
