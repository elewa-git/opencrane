import { describe, expect, it, vi } from "vitest";

import { __CreateHttpsMcpEraProbeClient } from "../mcp-era-probe";
import { McpEraProbeConfigurationError, McpEraProbeProtocolError, McpEraProbeTransportError } from "../mcp-era-probe.errors";
import type { McpEraProbeDnsAddress, McpEraProbeDnsResolver, McpEraProbeHttpsRequest, McpEraProbeHttpsRequestCommand, McpEraProbeHttpsResponse } from "../mcp-era-probe.types";

/** One public address returned by a deterministic resolver. */
const _PUBLIC_ADDRESS: McpEraProbeDnsAddress = { address: "93.184.216.34", family: 4 };

/** Builds one valid JSON-RPC discovery response. */
function _DiscoveryResponse(protocolVersion = "2026-07-28"): McpEraProbeHttpsResponse
{
	return { status: 200, headers: { "content-type": "application/json" }, body: new TextEncoder().encode(JSON.stringify({ jsonrpc: "2.0", id: "opencrane-mcp-era-probe", result: { resultType: "complete", supportedVersions: [protocolVersion], capabilities: {}, ttlMs: 3_600_000, cacheScope: "public" } })) };
}

/** Builds the client with public DNS by default and a deterministic HTTPS request function. */
function _Client(request: McpEraProbeHttpsRequest, resolve?: McpEraProbeDnsResolver)
{
	return __CreateHttpsMcpEraProbeClient({ protocolVersion: "2026-07-28", requestTimeoutMilliseconds: 1_000, maximumResponseBytes: 1_024, resolve: resolve ?? async function _resolve(): Promise<readonly McpEraProbeDnsAddress[]> { return [_PUBLIC_ADDRESS]; }, request });
}

/** Throws the supplied value to exercise one typed transport path. */
async function _Reject(error: unknown): Promise<McpEraProbeHttpsResponse>
{
	throw error;
}

describe("HTTPS MCP era probe", function _describeMcpEraProbe()
{
	it("uses only HTTPS server/discover and binds the request to the reviewed DNS address", async function _probesPinnedEra()
	{
		const request = vi.fn<McpEraProbeHttpsRequest>(async function _request(command: McpEraProbeHttpsRequestCommand): Promise<McpEraProbeHttpsResponse>
		{
			expect(command.resolvedAddress).toEqual(_PUBLIC_ADDRESS);
			expect(command.headers["MCP-Protocol-Version"]).toBe("2026-07-28");
			expect(command.headers["Mcp-Method"]).toBe("server/discover");
			expect(command.headers.accept).toBe("application/json, text/event-stream");
			expect(JSON.parse(new TextDecoder().decode(command.body))).toEqual({ jsonrpc: "2.0", id: "opencrane-mcp-era-probe", method: "server/discover", params: { _meta: { protocolVersion: "2026-07-28", clientCapabilities: {} } } });
			return _DiscoveryResponse();
		});

		const result = await _Client(request).probe({ endpoint: "https://mcp.example.com/discover" });

		expect(result.protocolVersion).toBe("2026-07-28");
		expect(result.evidenceDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
	});

	it("accepts a compliant Server-Sent Events discovery reply", async function _AcceptsSseDiscovery()
	{
		const response = _DiscoveryResponse();
		const body = new TextEncoder().encode(`event: message\ndata: ${new TextDecoder().decode(response.body)}\n\n`);
		const client = _Client(async function _Sse(): Promise<McpEraProbeHttpsResponse> { return { status: 200, headers: { "content-type": "text/event-stream" }, body }; });

		await expect(client.probe({ endpoint: "https://mcp.example.com" })).resolves.toMatchObject({ protocolVersion: "2026-07-28" });
	});

	it("refuses non-HTTPS URLs, credentials, and IP-literal endpoints before DNS", async function _refusesUnsafeEndpoints()
	{
		const resolve = vi.fn<McpEraProbeDnsResolver>(async function _resolve(): Promise<readonly McpEraProbeDnsAddress[]> { return [_PUBLIC_ADDRESS]; });
		const client = _Client(async function _request(): Promise<McpEraProbeHttpsResponse> { return _DiscoveryResponse(); }, resolve);

		for (const endpoint of ["http://mcp.example.com", "https://user:password@mcp.example.com", "https://127.0.0.1/mcp", "https://[::1]/mcp"])
		{
			await expect(client.probe({ endpoint })).rejects.toBeInstanceOf(McpEraProbeConfigurationError);
		}
		expect(resolve).not.toHaveBeenCalled();
	});

	it("rejects loopback, private, link-local, metadata, multicast, reserved, and mixed DNS answers", async function _refusesUnsafeDnsAnswers()
	{
		for (const address of ["127.0.0.1", "10.0.0.1", "169.254.169.254", "192.168.0.1", "224.0.0.1", "198.51.100.1"])
		{
			const client = _Client(async function _request(): Promise<McpEraProbeHttpsResponse> { return _DiscoveryResponse(); }, async function _resolve(): Promise<readonly McpEraProbeDnsAddress[]> { return [_PUBLIC_ADDRESS, { address, family: 4 }]; });
			await expect(client.probe({ endpoint: "https://mcp.example.com" })).rejects.toMatchObject({ name: "McpEraProbeConfigurationError", code: "unsafe_address" });
		}
	});

	it("refuses redirects, response bodies over the configured limit, and timeouts", async function _refusesUnsafeTransport()
	{
		const redirect = _Client(async function _redirect(): Promise<McpEraProbeHttpsResponse> { return { status: 302, headers: { location: "https://other.example.com" }, body: new Uint8Array() }; });
		const oversized = _Client(async function _oversized(): Promise<McpEraProbeHttpsResponse> { return { status: 200, headers: {}, body: new Uint8Array(1_025) }; });
		const timeout = _Client(async function _timeout(): Promise<McpEraProbeHttpsResponse> { return _Reject(Object.assign(new Error("timed out"), { name: "TimeoutError" })); });

		await expect(redirect.probe({ endpoint: "https://mcp.example.com" })).rejects.toMatchObject({ name: "McpEraProbeTransportError", code: "redirect" });
		await expect(oversized.probe({ endpoint: "https://mcp.example.com" })).rejects.toMatchObject({ name: "McpEraProbeTransportError", code: "oversize" });
		await expect(timeout.probe({ endpoint: "https://mcp.example.com" })).rejects.toMatchObject({ name: "McpEraProbeTransportError", code: "timeout" });
	});

	it("applies one wall-clock deadline even when the request never settles", async function _enforcesCompleteDeadline()
	{
		vi.useFakeTimers();
		try
		{
			const client = _Client(async function _neverSettles(): Promise<McpEraProbeHttpsResponse>
			{
				return await new Promise<McpEraProbeHttpsResponse>(function _pending() {});
			});
			const probe = client.probe({ endpoint: "https://mcp.example.com" });
			const rejected = expect(probe).rejects.toMatchObject({ name: "McpEraProbeTransportError", code: "timeout" });
			await vi.advanceTimersByTimeAsync(1_000);
			await rejected;
		}
		finally
		{
			vi.useRealTimers();
		}
	});

	it("rejects malformed JSON-RPC discovery replies and returns a validated different era", async function _refusesInvalidDiscovery()
	{
		const malformed = _Client(async function _malformed(): Promise<McpEraProbeHttpsResponse> { return { status: 200, headers: {}, body: new TextEncoder().encode("{") }; });
		const wrongEra = _Client(async function _wrongEra(): Promise<McpEraProbeHttpsResponse> { return _DiscoveryResponse("2025-06-18"); });

		await expect(malformed.probe({ endpoint: "https://mcp.example.com" })).rejects.toMatchObject({ name: "McpEraProbeProtocolError", code: "malformed_discovery" });
		await expect(wrongEra.probe({ endpoint: "https://mcp.example.com" })).resolves.toMatchObject({ protocolVersion: "2025-06-18" });
	});
});
