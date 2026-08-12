import { ___DoWithTrace } from "@opencrane/backend/observability";
import { ___CloneCanonicalJson } from "@opencrane/util";
import type { JsonValue } from "@opencrane/util";

import { __AssertToolAllowed, ObotMcpAuthenticationError, ObotMcpAuthorizationError } from "./obot-mcp-invocation.js";
import type { ObotMcpInvocationPort, ObotMcpToolInvocationCommand, ObotMcpToolResult } from "./obot-mcp-invocation.types.js";
import { ObotProtocolError, ObotTransportError } from "./obot-http.js";
import type { ObotSession } from "./obot-http.types.js";

/**
 * MCP protocol revision this client announces, and the only one it will accept back.
 *
 * The `initialize` handshake sends this and then rejects the server if it answers with anything
 * else, rather than falling back to whatever the server offers. A mismatch means the two sides
 * disagree about the wire format, and guessing across that gap is how a tool call gets silently
 * misread.
 * @see https://modelcontextprotocol.io/specification/2025-06-18 — the revision pinned here.
 */
const _MCP_PROTOCOL_VERSION = "2025-06-18";

/** Return a plain object suitable for validating an untrusted JSON-RPC response. */
function _AsObject(value: unknown): Record<string, unknown> | null
{
	return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** Extract one expected JSON-RPC result object without preserving remote error details. */
function _JsonRpcResult(payload: unknown, expectedId: number, expectation: string): Record<string, unknown>
{
	const envelope = _AsObject(payload);
	const result = _AsObject(envelope?.["result"]);
	if (envelope?.["jsonrpc"] !== "2.0" || envelope["id"] !== expectedId || "error" in (envelope ?? {}) || result === null)
	{
		throw new ObotProtocolError(expectation);
	}
	return result;
}

/** Extract a gateway-originated tool result while keeping the payload opaque to OpenCrane. */
function _ToolResult(payload: unknown): ObotMcpToolResult
{
	const result = _JsonRpcResult(payload, 2, "Obot MCP tools/call returned no valid result");
	if (!Object.hasOwn(result, "content")) throw new ObotProtocolError("Obot MCP tools/call returned no content result");
	const isError = result["isError"] ?? false;
	if (typeof isError !== "boolean") throw new ObotProtocolError("Obot MCP tools/call returned an invalid error flag");
	try
	{
		return { content: ___CloneCanonicalJson(result["content"] as JsonValue), isError };
	}
	catch
	{
		throw new ObotProtocolError("Obot MCP tools/call returned invalid content");
	}
}

/** Map only explicit Obot access refusals to safe typed failures; all other outcomes stay unchanged. */
function _RethrowSafeTransportFailure(error: unknown): never
{
	if (error instanceof ObotTransportError && error.code === "http_401") throw new ObotMcpAuthenticationError();
	if (error instanceof ObotTransportError && error.code === "http_403") throw new ObotMcpAuthorizationError();
	throw error;
}

/** Build the release-local MCP proxy path from an Obot-minted custody reference. */
function _McpPath(obotCustodyReference: string): string
{
	if (obotCustodyReference.trim().length === 0) throw new ObotProtocolError("Obot MCP custody reference is empty");
	return `/mcp-connect/${encodeURIComponent(obotCustodyReference)}/mcp`;
}

/**
 * Create the authenticated server-side MCP invocation adapter over one bounded Obot session.
 *
 * The adapter enforces the immutable revision allow-list before transport, performs the required
 * MCP initialize handshake, echoes only the validated session id, and returns only the validated
 * tool result. The service credential, remote bodies, and provider error details remain contained
 * by {@link ObotSession}.
 *
 * @param session - Authenticated bounded Obot session owned by the server process.
 * @returns The production MCP invocation port.
 */
export function __CreateHttpObotMcpInvocationAdapter(session: ObotSession): ObotMcpInvocationPort
{
	return {
		async invokeTool(command: ObotMcpToolInvocationCommand): Promise<ObotMcpToolResult>
		{
			// 1. Enforce revision authority before computing an endpoint or contacting Obot.
			__AssertToolAllowed(command);
			const path = _McpPath(command.obotCustodyReference);

			// 2. Keep the full two-exchange handshake under one safe operation span. Arguments, results,
			// custody addressing, credentials, and remote error details are deliberately excluded.
			return ___DoWithTrace("obot.mcp.invoke", { siloId: command.siloId, integrationId: command.integrationId, toolName: command.toolName }, async function _InvokeAllowedTool()
			{
				try
				{
					const initialized = await session.mcpRequest(path, {
						jsonrpc: "2.0",
						id: 1,
						method: "initialize",
						params: { protocolVersion: _MCP_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "opencrane-server", version: "1" } },
					});
					const initializeResult = _JsonRpcResult(initialized.payload, 1, "Obot MCP initialize returned no valid result");
					if (initializeResult["protocolVersion"] !== _MCP_PROTOCOL_VERSION) throw new ObotProtocolError("Obot MCP initialize returned an unsupported protocol version");

					// 3. Invoke only the admitted tool and return the validated gateway result. A missing session
					// id remains valid for servers that do not require stateful streamable HTTP.
					const answered = await session.mcpRequest(path, { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: command.toolName, arguments: command.arguments } }, initialized.sessionId ?? undefined);
					return _ToolResult(answered.payload);
				}
				catch (error)
				{
					return _RethrowSafeTransportFailure(error);
				}
			});
		},
	};
}
