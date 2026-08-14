import { ___DoWithTrace } from "@opencrane/backend/observability";
import { ___CloneCanonicalJson } from "@opencrane/util";
import type { JsonValue } from "@opencrane/util";

import { __AssertToolAllowed, ObotMcpAuthenticationError, ObotMcpAuthorizationError } from "./obot-mcp-invocation";
import type { ObotMcpInvocationPort, ObotMcpToolInvocationCommand, ObotMcpToolResult } from "./obot-mcp-invocation.types";
import { ObotProtocolError, ObotTransportError } from "./obot-http";
import type { ObotSession } from "./obot-http.types";

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

/**
 * Pull the `result` object out of one JSON-RPC reply, rejecting anything else.
 *
 * Requires `jsonrpc: "2.0"`, the exact id we sent, no `error` member, and an object `result`. Obot's
 * own error text is deliberately dropped: only the caller-supplied `expectation` string reaches the
 * thrown {@link ObotProtocolError}, so a remote message cannot end up in a log.
 *
 * @see https://www.jsonrpc.org/specification - JSON-RPC 2.0, which defines these members.
 */
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
 * Create the MCP invocation adapter that calls tools through one authenticated Obot session.
 *
 * Order matters: the tool allow-list is checked before any path is built or any request is sent, so
 * a tool the agent revision does not allow never reaches the network. The adapter then performs the
 * MCP `initialize` handshake, requires Obot to echo the pinned revision, replays only the validated
 * session id, and returns only a validated tool result. The service token, Obot's response bodies,
 * and its error details all stay inside {@link ObotSession} — what comes out is the tool result or
 * one of the typed errors below.
 *
 * Called by: apps/opencrane/src/infra/obot/obot-adapters.factory.ts; the port it returns is used by
 * libs/backend/agents/execution/protocol/src/integration-external-action-executor.ts.
 *
 * @param session - Authenticated Obot session owned by the server process.
 * @returns The production `ObotMcpInvocationPort` implementation.
 * @throws ObotMcpToolNotAllowedError When the tool is absent from the command's allow-list.
 * @throws ObotMcpAuthenticationError When Obot answers 401 to the server's service token.
 * @throws ObotMcpAuthorizationError When Obot answers 403 for this MCP endpoint.
 * @throws ObotProtocolError When the handshake, the revision echo, or the tool result is unusable.
 * @throws ObotTransportError For any other transport failure.
 * @see https://modelcontextprotocol.io/specification/2025-06-18 - the `initialize` and `tools/call`
 *   exchanges this adapter implements.
 */
export function __CreateHttpObotMcpInvocationAdapter(session: ObotSession): ObotMcpInvocationPort
{
	return {
		async invokeTool(command: ObotMcpToolInvocationCommand): Promise<ObotMcpToolResult>
		{
			// 1. Check the revision's tool allow-list first, before building a path or contacting Obot.
			__AssertToolAllowed(command);
			const path = _McpPath(command.obotCustodyReference);

			// 2. Trace both exchanges as one operation. Arguments, results, the custody reference,
			// credentials, and Obot's error details are deliberately kept out of the span.
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
