import { describe, expect, it } from "vitest";

import { __CreateHttpObotMcpInvocationAdapter } from "../http-obot-mcp-invocation";
import { ObotMcpAuthenticationError, ObotMcpAuthorizationError, ObotMcpToolNotAllowedError } from "../obot-mcp-invocation";
import type { ObotMcpToolInvocationCommand } from "../obot-mcp-invocation.types";
import { ObotProtocolError, ObotTransportError } from "../obot-http";
import type { ObotMcpExchangeResponse, ObotRequestMethod, ObotSession } from "../obot-http.types";

/** One MCP exchange recorded by the session double. */
interface _RecordedMcpExchange
{
	/** Release-local request path. */
	readonly path: string;
	/** JSON-RPC request payload. */
	readonly body: unknown;
	/** Validated session id echoed from initialize, when present. */
	readonly sessionId: string | undefined;
}

/** Build a session double returning MCP responses in order. */
function _Session(recorded: _RecordedMcpExchange[], responses: Array<ObotMcpExchangeResponse | Error>): ObotSession
{
	return {
		async request(_path: string, _method: ObotRequestMethod, _body?: unknown): Promise<never>
		{
			throw new Error("management exchange is outside this invocation test");
		},
		async mcpRequest(path: string, body: unknown, sessionId?: string): Promise<ObotMcpExchangeResponse>
		{
			recorded.push({ path, body, sessionId });
			const response = responses.shift();
			if (response === undefined) throw new Error("unexpected MCP exchange");
			if (response instanceof Error) throw response;
			return response;
		},
	};
}

/** Build an admitted MCP command with a two-tool immutable allow-list. */
function _Command(overrides: Partial<ObotMcpToolInvocationCommand> = {}): ObotMcpToolInvocationCommand
{
	return { siloId: "silo-1", integrationId: "calendar", obotCustodyReference: "server/opaque", toolName: "calendar.read", arguments: { day: "monday" }, allowedToolNames: ["calendar.read", "calendar.write"], ...overrides };
}

describe("HTTP Obot MCP invocation", function _InvocationSuite()
{
	it("initializes then invokes the allow-listed tool with the validated session id", async function _Invoke()
	{
		const recorded: _RecordedMcpExchange[] = [];
		const adapter = __CreateHttpObotMcpInvocationAdapter(_Session(recorded, [
			{ payload: { jsonrpc: "2.0", id: 1, result: { protocolVersion: "2025-06-18" } }, sessionId: "session-1" },
			{ payload: { jsonrpc: "2.0", id: 2, result: { content: [{ type: "text", text: "ok" }] } }, sessionId: null },
		]));

		await expect(adapter.invokeTool(_Command())).resolves.toEqual({ content: [{ type: "text", text: "ok" }], isError: false });
		expect(recorded).toHaveLength(2);
		expect(recorded[0]).toMatchObject({ path: "/mcp-connect/server%2Fopaque/mcp", sessionId: undefined, body: { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", clientInfo: { name: "opencrane-server", version: "1" } } } });
		expect(recorded[1]).toEqual({ path: "/mcp-connect/server%2Fopaque/mcp", sessionId: "session-1", body: { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "calendar.read", arguments: { day: "monday" } } } });
	});

	it("preserves a valid MCP tool-level failure result", async function _ToolFailureResult()
	{
		const adapter = __CreateHttpObotMcpInvocationAdapter(_Session([], [
			{ payload: { jsonrpc: "2.0", id: 1, result: { protocolVersion: "2025-06-18" } }, sessionId: null },
			{ payload: { jsonrpc: "2.0", id: 2, result: { content: [{ type: "text", text: "denied" }], isError: true } }, sessionId: null },
		]));
		await expect(adapter.invokeTool(_Command())).resolves.toEqual({ content: [{ type: "text", text: "denied" }], isError: true });
	});

	it("rejects a tool outside the allow-list before any Obot exchange", async function _RejectUnlisted()
	{
		const recorded: _RecordedMcpExchange[] = [];
		const adapter = __CreateHttpObotMcpInvocationAdapter(_Session(recorded, []));
		await expect(adapter.invokeTool(_Command({ toolName: "calendar.delete" }))).rejects.toBeInstanceOf(ObotMcpToolNotAllowedError);
		expect(recorded).toEqual([]);
	});

	it("refuses invalid initialize and tool responses without exposing remote details", async function _RejectInvalidResponses()
	{
		const initializeFailure = __CreateHttpObotMcpInvocationAdapter(_Session([], [{ payload: { jsonrpc: "2.0", id: 1, error: { message: "secret initialize detail" } }, sessionId: null }]));
		const initializeError = await initializeFailure.invokeTool(_Command()).then(function _unexpected(): never { throw new Error("expected initialize failure"); }, function _capture(error: unknown): Error { return error as Error; });
		expect(initializeError).toBeInstanceOf(ObotProtocolError);
		expect(initializeError.message).not.toContain("secret");

		const toolFailure = __CreateHttpObotMcpInvocationAdapter(_Session([], [
			{ payload: { jsonrpc: "2.0", id: 1, result: { protocolVersion: "2025-06-18" } }, sessionId: null },
			{ payload: { jsonrpc: "2.0", id: 2, error: { message: "secret tool detail" } }, sessionId: null },
		]));
		const toolError = await toolFailure.invokeTool(_Command()).then(function _unexpected(): never { throw new Error("expected tool failure"); }, function _capture(error: unknown): Error { return error as Error; });
		expect(toolError).toBeInstanceOf(ObotProtocolError);
		expect(toolError.message).not.toContain("secret");
	});

	it("maps only explicit 401 and 403 refusals to safe access failures", async function _AccessFailures()
	{
		const authentication = __CreateHttpObotMcpInvocationAdapter(_Session([], [new ObotTransportError("http_401")]));
		const authenticationError = await authentication.invokeTool(_Command()).then(function _unexpected(): never { throw new Error("expected authentication failure"); }, function _capture(error: unknown): Error { return error as Error; });
		expect(authenticationError).toBeInstanceOf(ObotMcpAuthenticationError);
		expect(authenticationError).toMatchObject({ name: "ObotMcpAuthenticationError", message: "Obot MCP authentication failed" });

		const authorization = __CreateHttpObotMcpInvocationAdapter(_Session([], [new ObotTransportError("http_403")]));
		await expect(authorization.invokeTool(_Command())).rejects.toBeInstanceOf(ObotMcpAuthorizationError);

		for (const code of ["timeout", "network", "http_500"] as const)
		{
			const ambiguous = __CreateHttpObotMcpInvocationAdapter(_Session([], [new ObotTransportError(code)]));
			await expect(ambiguous.invokeTool(_Command())).rejects.toMatchObject({ name: "ObotTransportError", code });
		}
	});

	it("refuses an empty custody reference before transport", async function _RejectEmptyReference()
	{
		const recorded: _RecordedMcpExchange[] = [];
		const adapter = __CreateHttpObotMcpInvocationAdapter(_Session(recorded, []));
		await expect(adapter.invokeTool(_Command({ obotCustodyReference: " " }))).rejects.toBeInstanceOf(ObotProtocolError);
		expect(recorded).toEqual([]);
	});
});
