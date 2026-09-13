import { describe, expect, it, vi } from "vitest";

import { __CreateHttpsMcpRemoteClient } from "../mcp-remote-client";
import { McpRemoteConfigurationError, McpRemoteProtocolError, McpRemoteTransportError } from "../mcp-remote-client.errors";
import { McpRemoteAuthorizationKinds, McpRemoteDeliveryStates, type McpRemoteDnsAddress, type McpRemoteDnsResolver, type McpRemoteHttpsRequest, type McpRemoteHttpsRequestCommand, type McpRemoteHttpsResponse } from "../mcp-remote-client.types";

/** One public address returned by a deterministic resolver. */
const _PUBLIC_ADDRESS: McpRemoteDnsAddress = { address: "93.184.216.34", family: 4 };

/** Build an un-aborted signal for one operation. */
function _Signal(): AbortSignal
{
	return new AbortController().signal;
}

/** Build a JSON response for the exact request id and result. */
function _Response(id: string, result: object): McpRemoteHttpsResponse
{
	return { status: 200, headers: { "content-type": "application/json" }, body: new TextEncoder().encode(JSON.stringify({ jsonrpc: "2.0", id, result })) };
}

/** Build one valid discovery response. */
function _DiscoveryResponse(protocolVersion = "2026-07-28"): McpRemoteHttpsResponse
{
	return _Response("opencrane-mcp-era-probe", { resultType: "complete", supportedVersions: [protocolVersion], capabilities: {}, ttlMs: 3_600_000, cacheScope: "public" });
}

/** Build the client with deterministic public DNS and request handling. */
function _Client(request: McpRemoteHttpsRequest, resolve?: McpRemoteDnsResolver)
{
	return __CreateHttpsMcpRemoteClient({ requestTimeoutMilliseconds: 1_000, maximumResponseBytes: 4_096, resolve: resolve ?? async function _Resolve(): Promise<readonly McpRemoteDnsAddress[]> { return [_PUBLIC_ADDRESS]; }, request });
}

describe("HTTPS MCP remote client", function _DescribeMcpRemoteClient()
{
	it("discovers only the pinned protocol through one reviewed DNS address", async function _DiscoversPinnedProtocol()
	{
		const request = vi.fn<McpRemoteHttpsRequest>(async function _Request(command: McpRemoteHttpsRequestCommand): Promise<McpRemoteHttpsResponse>
		{
			expect(command.resolvedAddress).toEqual(_PUBLIC_ADDRESS);
			expect(new Headers(command.headers).get("MCP-Protocol-Version")).toBe("2026-07-28");
			expect(new Headers(command.headers).get("Mcp-Method")).toBe("server/discover");
			expect(new Headers(command.headers).get("Authorization")).toBeNull();
			expect(JSON.parse(new TextDecoder().decode(command.body))).toMatchObject({ id: "opencrane-mcp-era-probe", method: "server/discover" });
			return _DiscoveryResponse();
		});

		const result = await _Client(request).discover({ endpoint: "https://mcp.example.com/discover", signal: _Signal() });

		expect(result.protocolVersion).toBe("2026-07-28");
		expect(result.evidenceDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
	});

	it("lists one validated tool page with ephemeral bearer authorization", async function _ListsTools()
	{
		const request = vi.fn<McpRemoteHttpsRequest>(async function _Request(command): Promise<McpRemoteHttpsResponse>
		{
			expect(new Headers(command.headers).get("Authorization")).toBe("Bearer test-token");
			expect(new Headers(command.headers).get("Mcp-Method")).toBe("tools/list");
			expect(new TextDecoder().decode(command.body)).not.toContain("test-token");
			return _Response("opencrane-mcp-tools", { resultType: "complete", tools: [{ name: "records.find", description: "Find records", inputSchema: { type: "object" } }], nextCursor: "page-2", ttlMs: 1_000, cacheScope: "private" });
		});

		const result = await _Client(request).listTools({ endpoint: "https://mcp.example.com", authorization: { kind: McpRemoteAuthorizationKinds.Bearer, token: "test-token" }, cursor: "page-1", signal: _Signal() });

		expect(result).toEqual({ tools: [{ name: "records.find", description: "Find records", inputSchema: { type: "object" } }], nextCursor: "page-2", cacheScope: "private" });
		const sent = JSON.parse(new TextDecoder().decode(request.mock.calls[0]?.[0].body)) as { params: { cursor: string } };
		expect(sent.params.cursor).toBe("page-1");
	});

	it("calls one admitted tool and mirrors only schema-declared primitive headers", async function _CallsTool()
	{
		const request = vi.fn<McpRemoteHttpsRequest>(async function _Request(command): Promise<McpRemoteHttpsResponse>
		{
			const headers = new Headers(command.headers);
			expect(headers.get("Authorization")).toBe("Bearer test-token");
			expect(headers.get("Mcp-Name")).toBe("records.find");
			expect(headers.get("Mcp-Param-account")).toBe("account-1");
			expect(headers.get("Mcp-Param-ignored")).toBeNull();
			return _Response("invocation-1", { resultType: "complete", content: [{ type: "text", text: "done" }], structuredContent: { count: 1 } });
		});

		const result = await _Client(request).callTool({ endpoint: "https://mcp.example.com", authorization: { kind: McpRemoteAuthorizationKinds.Bearer, token: "test-token" }, invocationId: "invocation-1", toolName: "records.find", arguments: { account: "account-1", ignored: "private" }, inputSchema: { type: "object", properties: { account: { type: "string", "x-mcp-header": "account" }, ignored: { type: "string" } } }, signal: _Signal() });

		expect(result).toEqual({ isError: false, content: [{ type: "text", text: "done" }], structuredContent: { count: 1 } });
	});

	it("rejects invalid endpoints, authorization, and mixed DNS before any request", async function _RejectsUnsafeInputs()
	{
		const request = vi.fn<McpRemoteHttpsRequest>();
		const resolve = vi.fn<McpRemoteDnsResolver>(async function _Resolve(): Promise<readonly McpRemoteDnsAddress[]> { return [_PUBLIC_ADDRESS, { address: "127.0.0.1", family: 4 }]; });
		const client = _Client(request, resolve);

		await expect(client.discover({ endpoint: "http://mcp.example.com", signal: _Signal() })).rejects.toMatchObject({ code: "invalid_endpoint", delivery: McpRemoteDeliveryStates.ProvenNotDispatched });
		await expect(client.discover({ endpoint: "https://mcp.example.com", authorization: { kind: McpRemoteAuthorizationKinds.Bearer, token: "bad\ntoken" }, signal: _Signal() })).rejects.toMatchObject({ code: "invalid_authorization", delivery: McpRemoteDeliveryStates.ProvenNotDispatched });
		await expect(client.discover({ endpoint: "https://mcp.example.com", signal: _Signal() })).rejects.toMatchObject({ code: "unsafe_address", delivery: McpRemoteDeliveryStates.ProvenNotDispatched });
		expect(request).not.toHaveBeenCalled();
	});

	it("rejects malformed call metadata and pagination before any request", async function _RejectsInvalidRequests()
	{
		const request = vi.fn<McpRemoteHttpsRequest>();
		const client = _Client(request);

		await expect(client.listTools({ endpoint: "https://mcp.example.com", cursor: "", signal: _Signal() })).rejects.toMatchObject({ code: "invalid_request", delivery: McpRemoteDeliveryStates.ProvenNotDispatched });
		await expect(client.callTool({ endpoint: "https://mcp.example.com", invocationId: "invocation-1", toolName: "records.find", arguments: {}, inputSchema: { type: "object", properties: { secret: { type: "string", "x-mcp-header": "bad header" } } }, signal: _Signal() })).rejects.toMatchObject({ code: "invalid_request", delivery: McpRemoteDeliveryStates.ProvenNotDispatched });
		expect(request).not.toHaveBeenCalled();
	});

	it("does not forward bearer authorization across a redirect", async function _RejectsRedirect()
	{
		const request = vi.fn<McpRemoteHttpsRequest>(async function _Redirect(command): Promise<McpRemoteHttpsResponse>
		{
			expect(command.endpoint.origin).toBe("https://mcp.example.com");
			expect(command.headers["Authorization"]).toBe("Bearer test-token");
			return { status: 302, headers: { location: "https://other.example.com" }, body: new Uint8Array() };
		});

		await expect(_Client(request).listTools({ endpoint: "https://mcp.example.com", authorization: { kind: McpRemoteAuthorizationKinds.Bearer, token: "test-token" }, signal: _Signal() })).rejects.toMatchObject({ code: "redirect", delivery: McpRemoteDeliveryStates.MaybeDispatched });
		expect(request).toHaveBeenCalledOnce();
	});

	it("classifies cancellation before and after request start conservatively", async function _ClassifiesCancellation()
	{
		const before = new AbortController();
		before.abort();
		const beforeRequest = vi.fn<McpRemoteHttpsRequest>();
		const beforeResolve = vi.fn<McpRemoteDnsResolver>();
		await expect(_Client(beforeRequest, beforeResolve).discover({ endpoint: "https://mcp.example.com", signal: before.signal })).rejects.toMatchObject({ code: "aborted", delivery: McpRemoteDeliveryStates.ProvenNotDispatched });
		expect(beforeResolve).not.toHaveBeenCalled();
		expect(beforeRequest).not.toHaveBeenCalled();

		vi.useFakeTimers();
		try
		{
			const request = vi.fn<McpRemoteHttpsRequest>(async function _Pending(): Promise<McpRemoteHttpsResponse> { return await new Promise(function _Never() {}); });
			const pending = _Client(request).callTool({ endpoint: "https://mcp.example.com", invocationId: "invocation-1", toolName: "records.find", arguments: {}, inputSchema: { type: "object" }, signal: _Signal() });
			const rejected = expect(pending).rejects.toMatchObject({ code: "timeout", delivery: McpRemoteDeliveryStates.MaybeDispatched });
			await vi.advanceTimersByTimeAsync(1_000);
			await rejected;
		}
		finally { vi.useRealTimers(); }
	});

	it("does not dispatch when DNS finishes after the wall-clock deadline", async function _TimesOutDuringDns()
	{
		vi.useFakeTimers();
		try
		{
			let finishResolution: ((addresses: readonly McpRemoteDnsAddress[]) => void) | undefined;
			const resolve = vi.fn<McpRemoteDnsResolver>(function _Resolve()
			{
				return new Promise(function _Pending(done) { finishResolution = done; });
			});
			const request = vi.fn<McpRemoteHttpsRequest>();
			const pending = _Client(request, resolve).discover({ endpoint: "https://mcp.example.com", signal: _Signal() });
			const rejected = expect(pending).rejects.toMatchObject({ code: "timeout", delivery: McpRemoteDeliveryStates.ProvenNotDispatched });
			await vi.advanceTimersByTimeAsync(1_000);
			await rejected;
			finishResolution?.([_PUBLIC_ADDRESS]);
			await vi.runAllTimersAsync();

			expect(resolve).toHaveBeenCalledOnce();
			expect(request).not.toHaveBeenCalled();
		}
		finally { vi.useRealTimers(); }
	});

	it("classifies request and malformed call failures without retaining sensitive input", async function _ClassifiesFailures()
	{
		const token = "secret-test-token";
		const endpoint = "https://sensitive.example.com/private";
		const network = _Client(async function _Network(): Promise<McpRemoteHttpsResponse> { throw new Error(`leaked ${token} ${endpoint}`); });
		let failure: unknown;
		try { await network.callTool({ endpoint, authorization: { kind: McpRemoteAuthorizationKinds.Bearer, token }, invocationId: "invocation-1", toolName: "records.find", arguments: {}, inputSchema: { type: "object" }, signal: _Signal() }); }
		catch (error) { failure = error; }
		expect(failure).toBeInstanceOf(McpRemoteTransportError);
		expect(failure).toMatchObject({ code: "network", delivery: McpRemoteDeliveryStates.MaybeDispatched });
		expect(String(failure)).not.toContain(token);
		expect(String(failure)).not.toContain(endpoint);

		const malformed = _Client(async function _Malformed(): Promise<McpRemoteHttpsResponse> { return { status: 200, headers: { "content-type": "application/json" }, body: new TextEncoder().encode("{") }; });
		await expect(malformed.callTool({ endpoint: "https://mcp.example.com", invocationId: "invocation-1", toolName: "records.find", arguments: {}, inputSchema: { type: "object" }, signal: _Signal() })).rejects.toMatchObject({ name: "McpRemoteProtocolError", code: "malformed_tool_result", delivery: McpRemoteDeliveryStates.MaybeDispatched });
	});

	it("returns a validated different discovery era for the catalogue decision", async function _ReportsDifferentEra()
	{
		const client = _Client(async function _WrongEra(): Promise<McpRemoteHttpsResponse> { return _DiscoveryResponse("2025-06-18"); });

		await expect(client.discover({ endpoint: "https://mcp.example.com", signal: _Signal() })).resolves.toMatchObject({ protocolVersion: "2025-06-18", cacheScope: "public" });
	});

	it("keeps public error classes bounded", function _KeepsErrorsBounded()
	{
		expect(new McpRemoteConfigurationError("unsafe_address")).toMatchObject({ delivery: McpRemoteDeliveryStates.ProvenNotDispatched });
		expect(new McpRemoteTransportError("network", McpRemoteDeliveryStates.MaybeDispatched)).toMatchObject({ code: "network" });
		expect(new McpRemoteProtocolError("malformed_discovery")).toMatchObject({ delivery: McpRemoteDeliveryStates.MaybeDispatched });
	});
});
