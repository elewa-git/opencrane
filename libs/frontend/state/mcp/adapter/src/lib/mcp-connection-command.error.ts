import { _ParseMcpConnectionProjection, type McpConnectionProjection } from "@opencrane/core";

import { McpConnectionCommandFailureKinds } from "./mcp-gateway.types";

/** Fixed messages keep provider responses and submitted credentials out of browser errors. */
const _MESSAGES: Readonly<Record<McpConnectionCommandFailureKinds, string>> = {
	[McpConnectionCommandFailureKinds.Rejected]: "The connection command was rejected. Check the details and try again.",
	[McpConnectionCommandFailureKinds.Unavailable]: "This connection is no longer available. Refresh your tools.",
	[McpConnectionCommandFailureKinds.Conflict]: "The connection changed. Refresh your tools before trying again.",
	[McpConnectionCommandFailureKinds.AccessChanged]: "Your access changed. Sign in again to manage connections.",
	[McpConnectionCommandFailureKinds.Uncertain]: "The connection response was interrupted. Retry the same request or refresh its status.",
};

/** Carries a safe retry decision; it never retains the original response, request or exception. */
export class McpConnectionCommandError extends Error
{
	/** Controls private-draft cleanup and whether the same admitted command can be retried. */
	public readonly kind: McpConnectionCommandFailureKinds;

	/** Construct a content-free error from the adapter's closed failure categories. */
	constructor(kind: McpConnectionCommandFailureKinds)
	{
		super(_MESSAGES[kind]);
		this.name = "McpConnectionCommandError";
		this.kind = kind;
	}
}

/** Interpret the public command response before any data becomes browser state. */
export function _ReadMcpConnectionResponse(status: number, value: unknown): McpConnectionProjection
{
	_RequireMcpConnectionAccess(status);
	if (status === 400)
		throw new McpConnectionCommandError(McpConnectionCommandFailureKinds.Rejected);
	if (status === 404)
		throw new McpConnectionCommandError(McpConnectionCommandFailureKinds.Unavailable);
	if (status === 409)
		throw new McpConnectionCommandError(McpConnectionCommandFailureKinds.Conflict);
	if (status !== 202)
		throw new McpConnectionCommandError(McpConnectionCommandFailureKinds.Uncertain);
	try { return _ParseMcpConnectionProjection(value); }
	catch { throw new McpConnectionCommandError(McpConnectionCommandFailureKinds.Uncertain); }
}

/** Report access loss on both commands and refresh reads so private drafts can be purged. */
export function _RequireMcpConnectionAccess(status: number): void
{
	if (status === 401 || status === 403)
		throw new McpConnectionCommandError(McpConnectionCommandFailureKinds.AccessChanged);
}

/** Preserve known decisions and discard untrusted network/parser exception details. */
export function _McpConnectionCommandError(error: unknown): McpConnectionCommandError
{
	if (error instanceof McpConnectionCommandError)
		return error;
	return new McpConnectionCommandError(McpConnectionCommandFailureKinds.Uncertain);
}
