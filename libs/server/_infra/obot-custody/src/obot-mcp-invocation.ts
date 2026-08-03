import type { ObotMcpToolInvocationCommand, ObotMcpTransportFailureCode } from "./obot-mcp-invocation.types.js";

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
 * Typed failure raised when the gateway could not be reached or answered outside the protocol.
 *
 * The bounded {@link ObotMcpTransportFailureCode} is the ONLY detail carried out of the transport:
 * remote bodies, tool arguments, and the custody reference never appear in the message.
 */
export class ObotMcpTransportError extends Error
{
	/** Bounded failure class safe to project into a durable invocation failure code. */
	readonly code: ObotMcpTransportFailureCode;

	/** Creates a transport failure that names only its bounded class. */
	constructor(code: ObotMcpTransportFailureCode)
	{
		super(`Obot MCP gateway transport failed: ${code}`);
		this.name = "ObotMcpTransportError";
		this.code = code;
	}
}

/** Typed failure raised when the gateway or the MCP server explicitly refused the tool call. */
export class ObotMcpRemoteRefusalError extends Error
{
	/** Creates a refusal naming only the tool, never the remote payload that explained it. */
	constructor(toolName: string)
	{
		super(`Obot MCP gateway refused the tool call: ${toolName}`);
		this.name = "ObotMcpRemoteRefusalError";
	}
}

/** Typed failure raised when a gateway response cannot prove a valid MCP result. */
export class ObotMcpProtocolError extends Error
{
	/** Creates a protocol failure that callers must not reinterpret as a tool result. */
	constructor(message: string)
	{
		super(message);
		this.name = "ObotMcpProtocolError";
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
