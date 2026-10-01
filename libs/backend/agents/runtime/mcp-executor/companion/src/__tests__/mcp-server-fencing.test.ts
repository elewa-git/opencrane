import { describe, expect, it, vi } from "vitest";

import { __CreateMcpCompanionServer, McpCompanionCommandKinds, type McpCompanionFetch } from "../index";

/** One admitted call; tests replace only the clock, response or saved arguments. */
const _COMMAND = { kind: McpCompanionCommandKinds.Invocation, lease: { executionId: "execution", claimFence: "fence", expiresAt: "2999-01-01T00:00:00.000Z" }, invocationId: "invocation-1", toolName: "calendar.read", arguments: {}, inputSchema: { type: "object" } } as const;

/** Build the real transport adapter around a controlled fetch boundary. */
function _server(fetcher: McpCompanionFetch)
{
	return __CreateMcpCompanionServer({ serverUrl: "http://127.0.0.1:3000/mcp", requestTimeoutMilliseconds: 1_000, maximumRequestBytes: 4_096, maximumResponseBytes: 256, fetch: fetcher });
}

describe("MCP dispatch fencing and cleanup", function _describeFencing()
{
	it("rejects a lease that expires while preparing the request, before any HTTP dispatch", async function _expiresDuringPreparation()
	{
		let now = Date.parse("2026-09-10T00:00:00.000Z");
		const expiresAt = new Date(now + 100).toISOString();
		const clock = vi.spyOn(Date, "now").mockImplementation(function _now() { return now; });
		const fetcher = vi.fn().mockResolvedValue(new Response('{"jsonrpc":"2.0","id":"invocation-1","result":{"resultType":"complete","content":[]}}', { headers: { "content-type": "application/json" } }));
		try
		{
			// The getter advances wall time during serialization without delivering an abort timer.
			const command = { ..._COMMAND, lease: { ..._COMMAND.lease, expiresAt }, arguments: { get day() { now += 200; return "today"; } } };
			await expect(_server(fetcher).call(command, new AbortController().signal)).rejects.toThrow(/lease expired/u);
			expect(fetcher).not.toHaveBeenCalled();
		}
		finally { clock.mockRestore(); }
	});

	it.each(["malformed", "oversize", "content-type", "http-error"])("cancels the response when rejecting %s data", async function _cancelsRejectedResponse(scenario)
	{
		const cancel = vi.fn();
		const body = new ReadableStream<Uint8Array>({
			start(controller) { controller.enqueue(new TextEncoder().encode("data: invalid-json\n\n")); },
			cancel,
		});
		const headers: Record<string, string> = { "content-type": "text/event-stream" };
		if (scenario === "oversize")
			headers["content-length"] = "257";
		if (scenario === "content-type")
			headers["content-type"] = "text/plain";
		const response = new Response(body, { headers, status: scenario === "http-error" ? 503 : 200 });
		const fetcher = vi.fn().mockResolvedValue(response);
		await expect(_server(fetcher).call(_COMMAND, new AbortController().signal)).rejects.toBeInstanceOf(Error);
		expect(cancel).toHaveBeenCalledOnce();
	});
});
