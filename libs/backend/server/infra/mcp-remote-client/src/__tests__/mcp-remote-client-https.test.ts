import type { LookupAddress } from "node:dns";
import type { ClientRequest, RequestOptions } from "node:http";

import { beforeEach, describe, expect, it, vi } from "vitest";

const _REQUEST = vi.hoisted(function _RequestMock()
{
	return vi.fn();
});

vi.mock("node:https", function _Https()
{
	return { request: _REQUEST };
});

import { _McpRemoteHttpsRequest } from "../mcp-remote-client-https";
import type { McpRemoteDnsAddress, McpRemoteHttpsRequestCommand } from "../mcp-remote-client.types";

/** Build a request that fails after exposing the exact Node socket options. */
function _CaptureOptions(address: McpRemoteDnsAddress): Promise<RequestOptions>
{
	let captured!: RequestOptions;
	_REQUEST.mockImplementationOnce(function _Request(_endpoint, options)
	{
		captured = options;
		return {
			setTimeout: vi.fn(),
			once: vi.fn(),
			end: vi.fn(function _End() { throw new Error("stop after option capture"); }),
		} as unknown as ClientRequest;
	});
	const command: McpRemoteHttpsRequestCommand = {
		endpoint: new URL("https://mcp.example.test/rpc"),
		headers: { "content-type": "application/json" },
		body: new TextEncoder().encode("{}"),
		resolvedAddress: address,
		signal: new AbortController().signal,
		timeoutMilliseconds: 5_000,
		maximumResponseBytes: 1_024,
		requestId: "request-1",
		malformedResponseCode: "malformed_tool_result",
	};
	return _McpRemoteHttpsRequest(command).catch(function _Captured()
	{
		return captured;
	});
}

describe("remote MCP HTTPS address pin", function _Suite()
{
	beforeEach(function _Reset() { _REQUEST.mockReset(); });

	it.each([
		{ address: "93.184.216.34", family: 4 as const },
		{ address: "2606:4700:4700::1111", family: 6 as const },
	])("pins the scalar lookup contract for IPv$family", async function _PinsAddress(address)
	{
		const options = await _CaptureOptions(address);
		expect(options.family).toBe(address.family);
		const callback = vi.fn();
		(options.lookup as NonNullable<RequestOptions["lookup"]>)("mcp.example.test", { all: false }, callback);
		expect(callback).toHaveBeenCalledExactlyOnceWith(null, address.address, address.family);
		expect(Array.isArray(callback.mock.calls[0]?.[1] as LookupAddress | string)).toBe(false);
	});
});
