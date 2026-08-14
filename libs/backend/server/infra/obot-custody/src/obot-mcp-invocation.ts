import type { ObotMcpToolInvocationCommand } from "./obot-mcp-invocation.types";

/**
 * Thrown when a run tries to call a tool its agent revision does not allow.
 *
 * This is a refusal, not a transport problem: nothing was sent to Obot. It is raised by
 * {@link __AssertToolAllowed}, which every invocation adapter calls first, so a stale or tampered
 * tool name cannot reach a provider.
 * libs/backend/agents/execution/protocol/src/production-external-action-adapter.ts maps it to the
 * durable failure code `integration_tool_not_allowed`, which means "no provider request was made" —
 * safe to fail the action outright with no recovery check.
 */
export class ObotMcpToolNotAllowedError extends Error
{
	/** Creates a fail-closed allow-list violation naming the rejected tool. */
	constructor(toolName: string)
	{
		super(`MCP tool is not in the revision allow-list: ${toolName}`);
		this.name = "ObotMcpToolNotAllowedError";
	}
}

/**
 * Thrown when this process has no Obot MCP transport configured at all.
 *
 * Raised only by the fail-closed stub in unavailable-obot-mcp-invocation.ts, which
 * apps/opencrane/src/infra/obot/obot-adapters.factory.ts composes when it finds no Obot
 * configuration. It exists so a deployment without Obot fails visibly instead of returning an empty
 * or invented tool result. production-external-action-adapter.ts maps it to the failure code
 * `integration_provider_unavailable`.
 */
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
 * Thrown when Obot rejects the server's own mounted service token (HTTP 401).
 *
 * Obot's response body is dropped on purpose, so this error carries no remote detail. It means the
 * OpenCrane server itself is not authenticated to Obot — a deployment or token-mount problem, not
 * something the end user did, and retrying will not help. production-external-action-adapter.ts
 * maps it to the failure code `AuthenticationError`.
 */
export class ObotMcpAuthenticationError extends Error
{
	/** Creates an authentication failure without retaining any remote response body. */
	constructor()
	{
		super("Obot MCP authentication failed");
		this.name = "ObotMcpAuthenticationError";
	}
}

/**
 * Thrown when Obot accepts the server's token but refuses it this MCP endpoint (HTTP 403).
 *
 * Again no remote body is kept. Retrying with the same custody reference will keep failing until
 * the grant on the Obot side changes. production-external-action-adapter.ts maps it to the failure
 * code `PermissionError` — note that this is a different code from the 401 case above, so the two
 * must not be collapsed.
 */
export class ObotMcpAuthorizationError extends Error
{
	/** Creates an authorization failure without retaining any remote response body. */
	constructor()
	{
		super("Obot MCP authorization failed");
		this.name = "ObotMcpAuthorizationError";
	}
}

/**
 * Check that an invocation names a tool the agent revision allows, and throw if it does not.
 *
 * This is the ONE enforcement point: every adapter calls it before touching a transport, so the
 * allow-list holds even for the fail-closed stub that has no transport at all. It compares
 * `command.toolName` against `command.allowedToolNames` and nothing else — filling that list from
 * the frozen revision's integration assignment is the caller's job.
 *
 * Called by: http-obot-mcp-invocation.ts and unavailable-obot-mcp-invocation.ts, both as the first
 * statement of `invokeTool`.
 *
 * @param command - The invocation to check.
 * @throws {ObotMcpToolNotAllowedError} When the tool is absent from the allow-list — including when
 *   the allow-list is empty, which rejects everything.
 */
export function __AssertToolAllowed(command: ObotMcpToolInvocationCommand): void
{
	if (!command.allowedToolNames.includes(command.toolName)) throw new ObotMcpToolNotAllowedError(command.toolName);
}
