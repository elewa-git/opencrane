import { ___DoWithoutTrace, ___DoWithTrace } from "@opencrane/observability";
import type { JsonValue } from "@opencrane/util";

import { __AssertToolAllowed, ObotMcpProtocolError, ObotMcpRemoteRefusalError, ObotMcpTransportError } from "./obot-mcp-invocation.js";
import type { ObotMcpFetch, ObotMcpInvocationHttpOptions, ObotMcpInvocationPort, ObotMcpToolInvocationCommand, ObotMcpToolResult } from "./obot-mcp-invocation.types.js";

/**
 * Maximum body accepted from one gateway exchange.
 *
 * Larger than the control-plane authority ceiling because a tool result carries remote payload the
 * gateway owns, not a fixed OpenCrane projection. It is still a hard allocation bound.
 */
const _MAX_RESPONSE_BYTES = 256 * 1024;

/** MCP revision this adapter negotiates; the gateway may answer with any revision it supports. */
const _MCP_PROTOCOL_VERSION = "2025-03-26";

/** JSON-RPC id of the initialize exchange within one invocation's session. */
const _INITIALIZE_ID = 1;

/** JSON-RPC id of the tools/call exchange within one invocation's session. */
const _TOOL_CALL_ID = 2;

/** Session header the streamable-HTTP transport uses to bind subsequent exchanges. */
const _SESSION_HEADER = "mcp-session-id";

/** Return a plain object suitable for security-boundary parsing. */
function _AsObject(value: unknown): Record<string, unknown> | null
{
	return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** Validate and normalize the in-cluster Obot MCP gateway origin. */
function _BaseUrl(value: string): URL
{
	const parsed = URL.parse(value);
	if (!parsed || parsed.protocol !== "http:" || parsed.pathname !== "/" || parsed.search !== "" || parsed.hash !== "" || parsed.username !== "" || parsed.password !== "")
	{
		throw new Error("OBOT_MCP_GATEWAY_URL must be one in-cluster HTTP origin with no path or credentials");
	}
	return parsed;
}

/** Combine the per-exchange timeout into one abort signal. */
function _RequestSignal(timeoutMilliseconds: number): AbortSignal
{
	return AbortSignal.timeout(timeoutMilliseconds);
}

/** Build headers for one streamable-HTTP MCP exchange, echoing any negotiated session. */
function _Headers(sessionId: string | null): Headers
{
	const headers = new Headers();
	headers.set("content-type", "application/json");
	headers.set("accept", "application/json, text/event-stream");
	if (sessionId !== null) headers.set(_SESSION_HEADER, sessionId);
	return headers;
}

/**
 * Read one gateway response without allocating beyond the fixed protocol ceiling.
 *
 * @param response - Gateway response whose body remains untrusted.
 * @returns The decoded body text.
 */
async function _ReadBoundedText(response: Response): Promise<string>
{
	const declaredLength = response.headers.get("content-length");
	if (declaredLength !== null)
	{
		const parsedLength = Number(declaredLength);
		if (!Number.isSafeInteger(parsedLength) || parsedLength < 0 || parsedLength > _MAX_RESPONSE_BYTES)
		{
			await response.body?.cancel();
			throw new ObotMcpTransportError("oversize");
		}
	}
	if (response.body === null) throw new ObotMcpProtocolError("Obot MCP gateway returned no response body");

	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let byteLength = 0;
	while (true)
	{
		const result = await reader.read();
		if (result.done) return Buffer.concat(chunks, byteLength).toString("utf8");
		byteLength += result.value.byteLength;
		if (byteLength > _MAX_RESPONSE_BYTES)
		{
			await reader.cancel();
			throw new ObotMcpTransportError("oversize");
		}
		chunks.push(result.value);
	}
}

/**
 * Return one SSE event's envelope when it parses and carries the expected id, or null.
 *
 * Returning null is what makes an event SKIPPABLE: a keep-alive, a fragment the gateway framed
 * differently, or any event that is simply not our answer must not abort the scan of the events
 * that follow it. Only the absence of a matching envelope in the WHOLE stream is a protocol failure.
 *
 * @param data - Concatenated `data:` payload of one complete event.
 * @param expectedId - JSON-RPC id the caller submitted.
 * @returns The matching envelope, or null when this event is not the answer.
 */
function _MatchingEventEnvelope(data: string, expectedId: number): Record<string, unknown> | null
{
	if (data.length === 0) return null;
	let parsed: unknown;
	try
	{
		parsed = JSON.parse(data) as unknown;
	}
	catch
	{
		return null;
	}
	const envelope = _AsObject(parsed);
	return envelope && envelope["id"] === expectedId ? envelope : null;
}

/**
 * Extract the JSON-RPC envelope carrying one expected id from a JSON or SSE-framed body.
 *
 * The JSON branch is terminal on a parse failure: that body IS the answer, so malformed bytes are a
 * protocol violation. The SSE branch is deliberately tolerant instead — events are accumulated to
 * their blank-line boundary (the spec joins repeated `data:` fields with newlines, so a payload may
 * legitimately span several lines) and any event that fails to parse is skipped rather than aborting
 * the scan. A single keep-alive or multi-line frame must not hide the response that follows it.
 *
 * @param body - Decoded response body.
 * @param contentType - Declared response content type.
 * @param expectedId - JSON-RPC id the caller submitted.
 * @returns The matching envelope object.
 */
function _ExtractEnvelope(body: string, contentType: string, expectedId: number): Record<string, unknown>
{
	if (!contentType.includes("text/event-stream"))
	{
		const envelope = _AsObject(_ParseJson(body));
		if (!envelope || envelope["id"] !== expectedId) throw new ObotMcpProtocolError("Obot MCP gateway returned a mismatched JSON-RPC response");
		return envelope;
	}
	let eventData: string[] = [];
	for (const rawLine of body.split("\n"))
	{
		const line = rawLine.replace(/\r$/u, "");
		if (line.length === 0)
		{
			// Blank line terminates one event; evaluate it, then start the next.
			const envelope = _MatchingEventEnvelope(eventData.join("\n"), expectedId);
			if (envelope) return envelope;
			eventData = [];
			continue;
		}
		// A leading `:` marks a comment line, which never starts with `data:`.
		if (line.startsWith("data:")) eventData.push(line.slice("data:".length).replace(/^ /u, ""));
	}
	// A stream may end without a terminating blank line; the trailing event still counts.
	const trailing = _MatchingEventEnvelope(eventData.join("\n"), expectedId);
	if (trailing) return trailing;
	throw new ObotMcpProtocolError("Obot MCP gateway event stream carried no matching JSON-RPC response");
}

/** Parse untrusted gateway JSON into an unknown value, failing as a protocol violation. */
function _ParseJson(text: string): unknown
{
	try
	{
		return JSON.parse(text) as unknown;
	}
	catch
	{
		throw new ObotMcpProtocolError("Obot MCP gateway returned malformed JSON");
	}
}

/**
 * Classify a fetch rejection into a bounded transport failure.
 *
 * Rethrows this adapter's own typed failures untouched so a refusal or protocol violation raised
 * while reading the body is not relabelled as a network fault.
 *
 * @param error - Value thrown by fetch or by bounded reading.
 * @returns Never; always throws.
 */
function _ThrowTransportFailure(error: unknown): never
{
	if (error instanceof ObotMcpTransportError || error instanceof ObotMcpProtocolError || error instanceof ObotMcpRemoteRefusalError) throw error;
	const isTimeout = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
	throw new ObotMcpTransportError(isTimeout ? "timeout" : "network");
}

/**
 * Create the streamable-HTTP Obot MCP invocation adapter.
 *
 * One invocation opens its own MCP session, calls exactly one tool, and closes the session. The
 * allow-list is enforced before any URL is built or any request is issued, so a tool outside the
 * revision's assignment never reaches the network. Neither the tool arguments, the custody
 * reference, nor any remote payload is placed in a trace attribute or an error message.
 *
 * The `obotCustodyReference` is treated as the OPAQUE gateway server identifier: it is percent
 * encoded into the `/mcp-connect/{server-id}` path and never parsed, split, or synthesized here.
 *
 * @param options - Gateway origin, per-exchange timeout, and the optional fetch test seam.
 * @returns A port that returns only gateway-originated tool results.
 */
export function __CreateHttpObotMcpInvocationAdapter(options: ObotMcpInvocationHttpOptions): ObotMcpInvocationPort
{
	const baseUrl = _BaseUrl(options.baseUrl);
	if (!Number.isSafeInteger(options.requestTimeoutMilliseconds) || options.requestTimeoutMilliseconds < 1_000 || options.requestTimeoutMilliseconds > 300_000)
	{
		throw new Error("Obot MCP invocation adapter requires a 1-300s request timeout");
	}
	const fetchRequest: ObotMcpFetch = options.fetch ?? fetch;

	/** Issue one JSON-RPC exchange against the session endpoint and return its raw response. */
	async function _Exchange(endpoint: URL, sessionId: string | null, body: string): Promise<Response>
	{
		try
		{
			return await ___DoWithoutTrace(function _fetchSensitiveEndpoint()
			{
				return fetchRequest(endpoint, { method: "POST", headers: _Headers(sessionId), body, signal: _RequestSignal(options.requestTimeoutMilliseconds), redirect: "error" });
			});
		}
		catch (error)
		{
			return _ThrowTransportFailure(error);
		}
	}

	/** Read one exchange's matching JSON-RPC envelope, mapping HTTP status to a bounded failure. */
	async function _ReadEnvelope(response: Response, expectedId: number): Promise<Record<string, unknown>>
	{
		if (!response.ok)
		{
			await response.body?.cancel();
			throw new ObotMcpTransportError(`http_${response.status}`);
		}
		try
		{
			const body = await _ReadBoundedText(response);
			return _ExtractEnvelope(body, response.headers.get("content-type") ?? "", expectedId);
		}
		catch (error)
		{
			return _ThrowTransportFailure(error);
		}
	}

	return {
		async invokeTool(command: ObotMcpToolInvocationCommand): Promise<ObotMcpToolResult>
		{
			// 1. Enforce the revision allow-list before any URL is built or any byte leaves the process.
			__AssertToolAllowed(command);

			return ___DoWithTrace("obot_mcp.tool.invoke", { siloId: command.siloId, integrationId: command.integrationId, toolName: command.toolName }, async function _invokeTool(): Promise<ObotMcpToolResult>
			{
				const endpoint = new URL(`/mcp-connect/${encodeURIComponent(command.obotCustodyReference)}`, baseUrl);

				// 2. Negotiate a session. A stateless gateway omits the header; later exchanges then
				//    simply carry none, which the transport permits.
				const initializeResponse = await _Exchange(endpoint, null, JSON.stringify({ jsonrpc: "2.0", id: _INITIALIZE_ID, method: "initialize", params: { protocolVersion: _MCP_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "opencrane-server", version: "1" } } }));
				const sessionId = initializeResponse.headers.get(_SESSION_HEADER);
				const initializeEnvelope = await _ReadEnvelope(initializeResponse, _INITIALIZE_ID);
				if (initializeEnvelope["error"] !== undefined) throw new ObotMcpRemoteRefusalError(command.toolName);

				try
				{
					// 3. Acknowledge initialization. Notifications carry no id and no result to read.
					const acknowledgement = await _Exchange(endpoint, sessionId, JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }));
					await acknowledgement.body?.cancel();

					// 4. Call exactly one allow-listed tool.
					const callResponse = await _Exchange(endpoint, sessionId, JSON.stringify({ jsonrpc: "2.0", id: _TOOL_CALL_ID, method: "tools/call", params: { name: command.toolName, arguments: command.arguments } }));
					const envelope = await _ReadEnvelope(callResponse, _TOOL_CALL_ID);
					if (envelope["error"] !== undefined) throw new ObotMcpRemoteRefusalError(command.toolName);

					const result = _AsObject(envelope["result"]);
					if (!result) throw new ObotMcpProtocolError("Obot MCP gateway returned a tool response without a result object");
					if (result["isError"] === true) throw new ObotMcpRemoteRefusalError(command.toolName);

					// The result is opaque OpenCrane never interprets; it originated from JSON.parse, so
					// it is JSON by construction.
					return { content: result as JsonValue };
				}
				finally
				{
					// 5. Release the session on every path. A gateway that rejects or ignores the close
					//    must not turn a completed tool call into a failure.
					if (sessionId !== null)
					{
						try
						{
							const closed = await ___DoWithoutTrace(function _closeSensitiveEndpoint()
							{
								return fetchRequest(endpoint, { method: "DELETE", headers: _Headers(sessionId), signal: _RequestSignal(options.requestTimeoutMilliseconds), redirect: "error" });
							});
							await closed.body?.cancel();
						}
						catch
						{
							// Deliberately swallowed: session cleanup is best effort.
						}
					}
				}
			});
		},
	};
}
