import { describe, expect, it, vi } from "vitest";

import { __CreateHttpMcpExecutorControllerAuthority } from "../http-mcp-executor-controller-authority";

/** Returns one exact server claim response. */
function _Claim()
{
	return { claim: { claimId: "claim-1", siloId: "silo-a", workloadClass: "mcp-executor", profileName: "mcp-isolated", idempotencyKey: "mcp:server-1", claimedAt: "2026-08-26T00:00:00.000Z", deliveryCount: 1, expiresAt: "2026-08-26T00:01:00.000Z", executionReference: "execution-1" }, registryReference: `registry.example.test/opencrane/mcp@sha256:${"a".repeat(64)}` };
}

/** Creates adapter options with replaceable fetch and token reads. */
function _Options(fetch: typeof globalThis.fetch, readToken = vi.fn().mockResolvedValue("token-1"))
{
	return { openCraneInternalUrl: "http://opencrane-server.silo-a.svc.cluster.local:3001", tokenPath: "/var/run/opencrane/tokens/opencrane.token", requestTimeoutMilliseconds: 1_000, fetch, readToken };
}

describe("HTTP MCP executor controller authority", function _DescribeAuthority()
{
	it("accepts one exact imported-image claim", async function _Claims()
	{
		const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(_Claim()), { status: 200 }));
		const authority = __CreateHttpMcpExecutorControllerAuthority(_Options(fetch));

		await expect(authority.__Claim(new AbortController().signal)).resolves.toEqual(_Claim());
		expect(fetch).toHaveBeenCalledWith(new URL("http://opencrane-server.silo-a.svc.cluster.local:3001/api/internal/agent-controller/mcp-executor:claim"), expect.objectContaining({ method: "POST" }));
	});

	it("rereads the projected token for every server request", async function _RereadsToken()
	{
		const readToken = vi.fn().mockResolvedValueOnce("token-1").mockResolvedValueOnce("token-2");
		const fetch = vi.fn().mockResolvedValueOnce(new Response(null, { status: 204 })).mockResolvedValueOnce(new Response(null, { status: 204 }));
		const authority = __CreateHttpMcpExecutorControllerAuthority(_Options(fetch, readToken));

		await authority.__Claim(new AbortController().signal);
		await authority.__ClaimRelease(new AbortController().signal);
		expect(readToken).toHaveBeenCalledTimes(2);
		expect((fetch.mock.calls[0]?.[1]?.headers as Headers).get("authorization")).toBe("Bearer token-1");
		expect((fetch.mock.calls[1]?.[1]?.headers as Headers).get("authorization")).toBe("Bearer token-2");
	});

	it("rejects a mutable image or unknown claim field", async function _RejectsInvalidClaim()
	{
		const invalid = { ..._Claim(), registryReference: "registry.example.test/opencrane/mcp:latest", extra: true };
		const authority = __CreateHttpMcpExecutorControllerAuthority(_Options(vi.fn().mockResolvedValue(new Response(JSON.stringify(invalid), { status: 200 }))));

		await expect(authority.__Claim(new AbortController().signal)).rejects.toThrow(/claim was invalid/);
	});
});
