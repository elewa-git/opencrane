import { describe, expect, it } from "vitest";

import { __CreateHttpObotMcpInvocationAdapter } from "../http-obot-mcp-invocation.js";
import { ObotMcpProtocolError, ObotMcpRemoteRefusalError, ObotMcpToolNotAllowedError, ObotMcpTransportError } from "../obot-mcp-invocation.js";
import type { ObotMcpFetch, ObotMcpToolInvocationCommand } from "../obot-mcp-invocation.types.js";

/** One recorded outbound exchange captured by the fetch seam. */
interface _RecordedRequest
{
	/** Absolute request URL as issued by the adapter. */
	readonly url: string;
	/** HTTP method of the exchange. */
	readonly method: string;
	/** Session header echoed on the exchange, when present. */
	readonly sessionId: string | null;
	/** Decoded JSON-RPC body, when the exchange carried one. */
	readonly body: Record<string, unknown> | null;
}

/** Builds an invocation command with an allow-list of one tool by default. */
function _command(overrides: Partial<ObotMcpToolInvocationCommand> = {}): ObotMcpToolInvocationCommand
{
	return { siloId: "silo-1", integrationId: "integ-1", obotCustodyReference: "server-abc", toolName: "slack.listChannels", arguments: { channel: "general" }, allowedTools: ["slack.listChannels"], ...overrides };
}

/** Builds a fetch seam answering initialize then tools/call with caller-supplied envelopes. */
function _fetchSeam(responses: { readonly initialize?: Response; readonly call?: Response; readonly sessionId?: string | null }, recorded: _RecordedRequest[]): ObotMcpFetch
{
	return async function _fetch(input: string | URL | Request, init?: RequestInit): Promise<Response>
	{
		const headers = new Headers(init?.headers);
		const rawBody = typeof init?.body === "string" ? init.body : null;
		const body = rawBody === null ? null : JSON.parse(rawBody) as Record<string, unknown>;
		recorded.push({ url: String(input), method: init?.method ?? "GET", sessionId: headers.get("mcp-session-id"), body });
		if (init?.method === "DELETE") return new Response(null, { status: 204 });
		if (body?.["method"] === "initialize")
		{
			const sessionId = responses.sessionId === undefined ? "session-1" : responses.sessionId;
			return responses.initialize ?? _jsonEnvelope({ jsonrpc: "2.0", id: 1, result: { protocolVersion: "2025-03-26" } }, sessionId);
		}
		if (body?.["method"] === "notifications/initialized") return new Response(null, { status: 202 });
		return responses.call ?? _jsonEnvelope({ jsonrpc: "2.0", id: 2, result: { content: [{ type: "text", text: "ok" }] } }, null);
	};
}

/** Builds a JSON-framed JSON-RPC response, optionally carrying a negotiated session header. */
function _jsonEnvelope(envelope: unknown, sessionId: string | null): Response
{
	const headers = new Headers({ "content-type": "application/json" });
	if (sessionId !== null) headers.set("mcp-session-id", sessionId);
	return new Response(JSON.stringify(envelope), { status: 200, headers });
}

/** Builds an SSE-framed response carrying unrelated events before the matching envelope. */
function _eventStreamEnvelope(envelope: unknown): Response
{
	const body = `event: message\ndata: {"jsonrpc":"2.0","id":99,"result":{"unrelated":true}}\n\nevent: message\ndata: ${JSON.stringify(envelope)}\n\n`;
	return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

/** Creates an adapter bound to the recording fetch seam. */
function _adapter(responses: Parameters<typeof _fetchSeam>[0], recorded: _RecordedRequest[])
{
	return __CreateHttpObotMcpInvocationAdapter({ baseUrl: "http://obot-mcp-gateway:8080", requestTimeoutMilliseconds: 30_000, fetch: _fetchSeam(responses, recorded) });
}

describe("HTTP Obot MCP invocation adapter construction", function _ConstructionSuite()
{
	it("rejects a base URL carrying a path, credentials, or TLS", function _RejectsBaseUrl()
	{
		expect(() => __CreateHttpObotMcpInvocationAdapter({ baseUrl: "http://gateway:8080/mcp", requestTimeoutMilliseconds: 30_000 })).toThrow(/in-cluster HTTP origin/);
		expect(() => __CreateHttpObotMcpInvocationAdapter({ baseUrl: "http://user:pass@gateway:8080", requestTimeoutMilliseconds: 30_000 })).toThrow(/in-cluster HTTP origin/);
		expect(() => __CreateHttpObotMcpInvocationAdapter({ baseUrl: "not a url", requestTimeoutMilliseconds: 30_000 })).toThrow(/in-cluster HTTP origin/);
	});

	it("rejects a timeout outside the supported band", function _RejectsTimeout()
	{
		expect(() => __CreateHttpObotMcpInvocationAdapter({ baseUrl: "http://gateway:8080", requestTimeoutMilliseconds: 10 })).toThrow(/1-300s request timeout/);
	});
});

describe("HTTP Obot MCP invocation adapter", function _AdapterSuite()
{
	it("rejects a non-allow-listed tool before issuing any request", async function _AllowListFirst()
	{
		const recorded: _RecordedRequest[] = [];
		await expect(_adapter({}, recorded).invokeTool(_command({ toolName: "slack.deleteChannel" }))).rejects.toBeInstanceOf(ObotMcpToolNotAllowedError);
		expect(recorded).toHaveLength(0);
	});

	it("negotiates a session, calls the tool, and echoes the session on later exchanges", async function _NegotiatesSession()
	{
		const recorded: _RecordedRequest[] = [];
		const result = await _adapter({}, recorded).invokeTool(_command());

		expect(result.content).toEqual({ content: [{ type: "text", text: "ok" }] });
		expect(recorded.map(function _method(entry) { return entry.method; })).toEqual(["POST", "POST", "POST", "DELETE"]);
		// The opaque custody reference is the server-id path segment and is never parsed.
		expect(recorded[0].url).toBe("http://obot-mcp-gateway:8080/mcp-connect/server-abc");
		expect(recorded[0].sessionId).toBeNull();
		expect(recorded[1].sessionId).toBe("session-1");
		expect(recorded[2].body).toMatchObject({ method: "tools/call", params: { name: "slack.listChannels", arguments: { channel: "general" } } });
		expect(recorded[3].method).toBe("DELETE");
	});

	it("percent-encodes a custody reference without treating it as a path", async function _EncodesReference()
	{
		const recorded: _RecordedRequest[] = [];
		await _adapter({}, recorded).invokeTool(_command({ obotCustodyReference: "tenant/one" }));
		expect(recorded[0].url).toBe("http://obot-mcp-gateway:8080/mcp-connect/tenant%2Fone");
	});

	it("omits the session header and the close exchange for a stateless gateway", async function _StatelessGateway()
	{
		const recorded: _RecordedRequest[] = [];
		await _adapter({ sessionId: null }, recorded).invokeTool(_command());
		expect(recorded.every(function _noSession(entry) { return entry.sessionId === null; })).toBe(true);
		expect(recorded.some(function _isDelete(entry) { return entry.method === "DELETE"; })).toBe(false);
	});

	it("parses an SSE-framed result and skips unrelated events", async function _ParsesEventStream()
	{
		const recorded: _RecordedRequest[] = [];
		const result = await _adapter({ call: _eventStreamEnvelope({ jsonrpc: "2.0", id: 2, result: { content: "streamed" } }) }, recorded).invokeTool(_command());
		expect(result.content).toEqual({ content: "streamed" });
	});

	it("skips an unparseable SSE event instead of abandoning the scan", async function _SkipsMalformedEvent()
	{
		// A keep-alive or any non-JSON frame must not hide the answer that follows it.
		const body = `event: ping\ndata: keep-alive\n\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: 2, result: { content: "after-noise" } })}\n\n`;
		const call = new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
		const result = await _adapter({ call }, []).invokeTool(_command());
		expect(result.content).toEqual({ content: "after-noise" });
	});

	it("reassembles an SSE payload split across repeated data fields", async function _ReassemblesMultiLineEvent()
	{
		// A pretty-printed envelope is emitted as one `data:` field per line; the SSE spec rejoins them
		// with newlines before the payload is parsed.
		const lines = JSON.stringify({ jsonrpc: "2.0", id: 2, result: { content: "split" } }, null, 2).split("\n");
		const body = `${lines.map(function _asDataField(line) { return `data: ${line}`; }).join("\n")}\n\n`;
		const call = new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
		const result = await _adapter({ call }, []).invokeTool(_command());
		expect(result.content).toEqual({ content: "split" });
	});

	it("accepts a trailing SSE event with no terminating blank line", async function _TrailingEvent()
	{
		const body = `data: ${JSON.stringify({ jsonrpc: "2.0", id: 2, result: { content: "trailing" } })}`;
		const call = new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
		const result = await _adapter({ call }, []).invokeTool(_command());
		expect(result.content).toEqual({ content: "trailing" });
	});

	it("still fails closed when no SSE event carries the expected id", async function _NoMatchingEvent()
	{
		const body = `data: not json\n\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: 99, result: {} })}\n\n`;
		const call = new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
		await expect(_adapter({ call }, []).invokeTool(_command())).rejects.toBeInstanceOf(ObotMcpProtocolError);
	});

	it("treats a JSON-RPC error as a remote refusal naming only the tool", async function _JsonRpcError()
	{
		const recorded: _RecordedRequest[] = [];
		const call = _jsonEnvelope({ jsonrpc: "2.0", id: 2, error: { code: -32000, message: "workspace secret ABC123 rejected" } }, null);
		const failure = await _adapter({ call }, recorded).invokeTool(_command()).catch(function _capture(error: unknown) { return error; });

		expect(failure).toBeInstanceOf(ObotMcpRemoteRefusalError);
		// The remote message may quote arguments or credentials; it must never reach our error text.
		expect((failure as Error).message).not.toMatch(/ABC123|general/);
	});

	it("treats an isError tool result as a remote refusal", async function _IsErrorResult()
	{
		const recorded: _RecordedRequest[] = [];
		const call = _jsonEnvelope({ jsonrpc: "2.0", id: 2, result: { isError: true, content: [] } }, null);
		await expect(_adapter({ call }, recorded).invokeTool(_command())).rejects.toBeInstanceOf(ObotMcpRemoteRefusalError);
	});

	it("rejects a mismatched or malformed envelope as a protocol violation", async function _ProtocolViolation()
	{
		const recorded: _RecordedRequest[] = [];
		await expect(_adapter({ call: _jsonEnvelope({ jsonrpc: "2.0", id: 7, result: {} }, null) }, recorded).invokeTool(_command())).rejects.toBeInstanceOf(ObotMcpProtocolError);
		await expect(_adapter({ call: new Response("{not json", { status: 200, headers: { "content-type": "application/json" } }) }, []).invokeTool(_command())).rejects.toBeInstanceOf(ObotMcpProtocolError);
		await expect(_adapter({ call: _jsonEnvelope({ jsonrpc: "2.0", id: 2, result: "text" }, null) }, []).invokeTool(_command())).rejects.toBeInstanceOf(ObotMcpProtocolError);
	});

	it("maps an HTTP failure status to a bounded transport code", async function _HttpStatus()
	{
		const failure = await _adapter({ call: new Response("denied", { status: 503 }) }, []).invokeTool(_command()).catch(function _capture(error: unknown) { return error; });
		expect(failure).toBeInstanceOf(ObotMcpTransportError);
		expect((failure as ObotMcpTransportError).code).toBe("http_503");
	});

	it("maps a timeout and a network fault to bounded transport codes", async function _TransportFaults()
	{
		const timeoutAdapter = __CreateHttpObotMcpInvocationAdapter({
			baseUrl: "http://obot-mcp-gateway:8080",
			requestTimeoutMilliseconds: 1_000,
			fetch: async function _timeout(): Promise<Response> { throw Object.assign(new Error("timed out"), { name: "TimeoutError" }); },
		});
		const timeout = await timeoutAdapter.invokeTool(_command()).catch(function _capture(error: unknown) { return error; });
		expect((timeout as ObotMcpTransportError).code).toBe("timeout");

		const networkAdapter = __CreateHttpObotMcpInvocationAdapter({
			baseUrl: "http://obot-mcp-gateway:8080",
			requestTimeoutMilliseconds: 1_000,
			fetch: async function _network(): Promise<Response> { throw new TypeError("connection refused"); },
		});
		const network = await networkAdapter.invokeTool(_command()).catch(function _capture(error: unknown) { return error; });
		expect((network as ObotMcpTransportError).code).toBe("network");
	});

	it("refuses a response body beyond the protocol ceiling", async function _Oversize()
	{
		const oversized = new Response("x".repeat(16), { status: 200, headers: { "content-type": "application/json", "content-length": String(512 * 1024) } });
		const failure = await _adapter({ call: oversized }, []).invokeTool(_command()).catch(function _capture(error: unknown) { return error; });
		expect(failure).toBeInstanceOf(ObotMcpTransportError);
		expect((failure as ObotMcpTransportError).code).toBe("oversize");
	});

	it("still closes the session when the tool call fails", async function _ClosesOnFailure()
	{
		const recorded: _RecordedRequest[] = [];
		await expect(_adapter({ call: new Response("no", { status: 500 }) }, recorded).invokeTool(_command())).rejects.toBeInstanceOf(ObotMcpTransportError);
		expect(recorded.some(function _isDelete(entry) { return entry.method === "DELETE"; })).toBe(true);
	});
});
