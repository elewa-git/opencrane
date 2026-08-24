import { describe, expect, it, vi } from "vitest";

import { __CreateHttpMcpbValidationControllerAuthority } from "../http-mcpb-validation-controller-authority";

/** Return adapter settings with a projected token reader replaced for a focused test. */
function _Options(fetch: typeof globalThis.fetch)
{
	return { openCraneInternalUrl: "http://opencrane-server.silo-a.svc.cluster.local:8081", tokenPath: "/var/run/opencrane/tokens/opencrane.token", requestTimeoutMilliseconds: 1_000, fetch, readToken: vi.fn().mockResolvedValue("projected-token") };
}

/** Return one valid saved MCP bundle inspection claim. */
function _Claim()
{
	return { workloadId: "workload-1", siloId: "silo-1", validationId: "validation-1", claimedAt: "2026-08-25T00:00:00.000Z", deliveryCount: 1, expiresAt: "2026-08-25T00:01:00.000Z" };
}

/** Return a stream which crosses the response limit in two chunks. */
function _OversizedResponse(): Response
{
	let part = 0;
	return new Response(new ReadableStream<Uint8Array>({
		pull(controller)
		{
			if (part === 0)
			{
				controller.enqueue(new Uint8Array(16 * 1024));
			}
			else if (part === 1)
			{
				controller.enqueue(new Uint8Array(1));
			}
			else
			{
				controller.close();
			}
			part += 1;
		},
	}));
}

describe("HTTP MCP bundle validation controller authority", function _McpbValidationAuthoritySuite()
{
	it("reads one bounded claim through the projected controller token", async function _Claims()
	{
		const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(_Claim()), { status: 200 }));
		const authority = __CreateHttpMcpbValidationControllerAuthority(_Options(fetch));

		expect(await authority.__Claim(new AbortController().signal)).toEqual(_Claim());
	});

	it("cancels a chunked response as soon as it exceeds the response limit", async function _BoundsResponse()
	{
		const authority = __CreateHttpMcpbValidationControllerAuthority(_Options(vi.fn().mockResolvedValue(_OversizedResponse())));

		await expect(authority.__Claim(new AbortController().signal)).rejects.toThrow(/exceeded the 16 KiB boundary/);
	});
});
