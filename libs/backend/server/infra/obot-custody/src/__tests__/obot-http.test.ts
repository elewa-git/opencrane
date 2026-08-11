import { context, ROOT_CONTEXT } from "@opentelemetry/api";
import type { Context } from "@opentelemetry/api";
import { isTracingSuppressed } from "@opentelemetry/core";
import { beforeAll, describe, expect, it } from "vitest";

import { __CreateObotSession, ObotProtocolError, ObotTransportError } from "../obot-http.js";
import type { ObotFetch, ObotHttpOptions } from "../obot-http.types.js";

/** One recorded outbound exchange captured by the fetch seam. */
interface _RecordedRequest
{
	/** Request path as issued by the session. */
	readonly path: string;
	/** HTTP method as issued by the session. */
	readonly method: string;
	/** Decoded JSON body, when the exchange carried one. */
	readonly body: Record<string, unknown> | null;
	/** Authorization header, when the exchange carried one. */
	readonly authorization: string | null;
	/** Whether automatic child tracing was suppressed. */
	readonly tracingSuppressed: boolean;
	/** MCP session id echoed by the client, when present. */
	readonly mcpSessionId: string | null;
	/** Accepted response media types. */
	readonly accept: string | null;
}

/** Active context maintained by the synchronous test context manager. */
let _activeContext = ROOT_CONTEXT;

/** Install enough context propagation to observe fetch suppression at the test seam. */
function _RegisterContextManager(): void
{
	context.setGlobalContextManager({
		active(): Context { return _activeContext; },
		with<A extends unknown[], F extends (...args: A) => ReturnType<F>>(next: Context, callback: F, thisArg?: ThisParameterType<F>, ...args: A): ReturnType<F>
		{
			const previous = _activeContext;
			_activeContext = next;
			try { return callback.apply(thisArg, args); }
			finally { _activeContext = previous; }
		},
		bind<T>(_context: Context, target: T): T { return target; },
		enable() { return this; },
		disable() { return this; },
	});
}

beforeAll(function _registerContextManager(): void { _RegisterContextManager(); });

/** Builds a fetch seam recording exchanges and answering with the supplied responder. */
function _fetchSeam(recorded: _RecordedRequest[], respond: () => Response | Promise<Response>): ObotFetch
{
	return async function _fetch(input: string | URL | Request, init?: RequestInit): Promise<Response>
	{
		const url = new URL(String(input));
		const headers = new Headers(init?.headers);
		const rawBody = typeof init?.body === "string" ? init.body : null;
		recorded.push({ path: url.pathname, method: init?.method ?? "GET", body: rawBody === null ? null : JSON.parse(rawBody) as Record<string, unknown>, authorization: headers.get("authorization"), tracingSuppressed: isTracingSuppressed(context.active()), mcpSessionId: headers.get("mcp-session-id"), accept: headers.get("accept") });
		return respond();
	};
}

/** Builds a JSON response. */
function _json(payload: unknown, status = 200): Response
{
	return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
}

/** Creates a session bound to the recording seam with an injected token reader. */
function _session(recorded: _RecordedRequest[], respond: () => Response | Promise<Response>, extra: Partial<ObotHttpOptions> = {})
{
	return __CreateObotSession({ baseUrl: "http://oc-mcp-gateway.silo.svc.cluster.local:8080", requestTimeoutMilliseconds: 30_000, serviceTokenFile: "/var/run/opencrane/obot/token", readServiceToken: async function _readToken() { return "obot-service-token"; }, fetch: _fetchSeam(recorded, respond), ...extra });
}

describe("Obot HTTP session", function _SessionSuite()
{
	it("rejects external, pathful, or credentialed origins before any token read", function _RejectOrigin()
	{
		let tokenRead = false;
		const readServiceToken = async function _readToken(): Promise<string> { tokenRead = true; return "obot-service-token"; };
		for (const baseUrl of ["http://attacker.example:8080", "https://oc-mcp-gateway.silo.svc.cluster.local:8080", "http://oc-mcp-gateway.silo.svc.cluster.local:8080/mcp-connect", "http://user:pass@oc-mcp-gateway.silo.svc.cluster.local:8080"])
		{
			expect(function _CreateInvalid() { _session([], function _never() { return _json(null); }, { baseUrl, readServiceToken }); }).toThrow("OBOT_GATEWAY_URL");
		}
		expect(tokenRead).toBe(false);
	});

	it("rejects out-of-bounds timeouts and relative token paths", function _RejectOptions()
	{
		expect(function _TooShort() { _session([], function _never() { return _json(null); }, { requestTimeoutMilliseconds: 999 }); }).toThrow("1 and 300 seconds");
		expect(function _TooLong() { _session([], function _never() { return _json(null); }, { requestTimeoutMilliseconds: 300_001 }); }).toThrow("1 and 300 seconds");
		expect(function _Relative() { __CreateObotSession({ baseUrl: "http://oc-mcp-gateway.silo.svc.cluster.local:8080", requestTimeoutMilliseconds: 30_000, serviceTokenFile: "relative/token" }); }).toThrow("absolute");
	});

	it("presents the freshly read bearer token and suppresses child tracing", async function _AuthenticatedExchange()
	{
		const recorded: _RecordedRequest[] = [];
		const result = await _session(recorded, function _ok() { return _json({ id: "srv-1" }); }).request("/api/mcp-servers", "POST", { catalogEntryID: "cat-1" });
		expect(result).toEqual({ id: "srv-1" });
		expect(recorded[0]).toMatchObject({ path: "/api/mcp-servers", method: "POST", body: { catalogEntryID: "cat-1" }, authorization: "Bearer obot-service-token", tracingSuppressed: true });
	});

	it("maps timeouts, network faults, statuses, oversize, and malformed JSON to typed failures", async function _FailureTaxonomy()
	{
		const timeoutError = new Error("timed out");
		timeoutError.name = "TimeoutError";
		await expect(_session([], function _timeout(): Response { throw timeoutError; }).request("/api/me", "GET")).rejects.toMatchObject({ name: "ObotTransportError", code: "timeout" });
		await expect(_session([], function _network(): Response { throw new TypeError("fetch failed"); }).request("/api/me", "GET")).rejects.toMatchObject({ name: "ObotTransportError", code: "network" });
		await expect(_session([], function _status() { return new Response(null, { status: 503 }); }).request("/api/me", "GET")).rejects.toMatchObject({ name: "ObotTransportError", code: "http_503" });
		await expect(_session([], function _oversize() { return new Response("x".repeat(300 * 1024), { status: 200 }); }).request("/api/me", "GET")).rejects.toMatchObject({ name: "ObotTransportError", code: "oversize" });
		await expect(_session([], function _malformed() { return new Response("{not json", { status: 200 }); }).request("/api/me", "GET")).rejects.toBeInstanceOf(ObotProtocolError);
	});

	it("returns null for an empty success body", async function _EmptyBody()
	{
		await expect(_session([], function _empty() { return new Response(null, { status: 200 }); }).request("/api/mcp-servers/srv-1", "DELETE")).resolves.toBeNull();
	});

	it("parses bounded MCP JSON and event-stream responses while echoing only the session id", async function _McpExchange()
	{
		const recorded: _RecordedRequest[] = [];
		const responses = [
			new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} }), { status: 200, headers: { "content-type": "application/json", "mcp-session-id": "session-1" } }),
			new Response(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: 2, result: { content: [] } })}\n\n`, { status: 200, headers: { "content-type": "text/event-stream; charset=utf-8" } }),
		];
		const session = _session(recorded, function _nextResponse(): Response { return responses.shift() as Response; });
		await expect(session.mcpRequest("/mcp-connect/server-1/mcp", { jsonrpc: "2.0", id: 1, method: "initialize" })).resolves.toEqual({ payload: { jsonrpc: "2.0", id: 1, result: {} }, sessionId: "session-1" });
		await expect(session.mcpRequest("/mcp-connect/server-1/mcp", { jsonrpc: "2.0", id: 2, method: "tools/call" }, "session-1")).resolves.toEqual({ payload: { jsonrpc: "2.0", id: 2, result: { content: [] } }, sessionId: null });
		expect(recorded).toMatchObject([
			{ path: "/mcp-connect/server-1/mcp", method: "POST", authorization: "Bearer obot-service-token", mcpSessionId: null, accept: "application/json, text/event-stream", tracingSuppressed: true },
			{ path: "/mcp-connect/server-1/mcp", method: "POST", authorization: "Bearer obot-service-token", mcpSessionId: "session-1", accept: "application/json, text/event-stream", tracingSuppressed: true },
		]);
	});

	it("refuses malformed MCP media, event frames, and session ids without exposing bodies", async function _RejectMalformedMcp()
	{
		const cases = [
			new Response("secret-plain-text", { status: 200, headers: { "content-type": "text/plain" } }),
			new Response("event: message\n\n", { status: 200, headers: { "content-type": "text/event-stream" } }),
			new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json", "mcp-session-id": "x".repeat(1_025) } }),
		];
		for (const response of cases)
		{
			const failure = await _session([], function _response() { return response; }).mcpRequest("/mcp-connect/server-1/mcp", {}).then(function _unexpected(): never { throw new Error("expected MCP protocol failure"); }, function _capture(error: unknown): Error { return error as Error; });
			expect(failure).toBeInstanceOf(ObotProtocolError);
			expect(failure.message).not.toContain("secret");
		}
	});

	it("carries only the bounded code in transport failure messages", async function _NoBodyLeak()
	{
		const failure = await _session([], function _status() { return new Response(JSON.stringify({ secret: "credential-value" }), { status: 500 }); }).request("/api/me", "GET").catch(function _capture(error: unknown) { return error as ObotTransportError; });
		expect(failure).toBeInstanceOf(ObotTransportError);
		expect((failure as ObotTransportError).message).not.toContain("credential-value");
	});
});
