import { describe, expect, it, vi } from "vitest";

import { __CreateHttpSkillWorkloadControllerAuthority } from "../http-skill-workload-authority";

/** Return adapter options whose `fetch` and token reader a test can replace. */
function _Options(fetch: typeof globalThis.fetch)
{
	return { openCraneInternalUrl: "http://opencrane-server.silo-a.svc.cluster.local:3001", tokenPath: "/var/run/opencrane/tokens/opencrane.token", requestTimeoutMilliseconds: 1_000, fetch, readToken: vi.fn().mockResolvedValue("projected-token") };
}

/** Return one claim response body. */
function _Claim()
{
	return { workloadId: "workload-1", siloId: "silo-a", kind: "authoring", skillRevisionId: "revision-1", claimedAt: "2026-07-24T00:00:00.000Z", deliveryCount: 1, expiresAt: "2026-07-24T00:00:30.000Z" };
}

/** Return a chunked response larger than the 16 KiB limit. */
function _OversizedChunkedResponse(maximumBytes: number): Response
{
	let chunk = 0;
	return new Response(new ReadableStream<Uint8Array>({
		pull(controller)
		{
			if (chunk === 0) controller.enqueue(new Uint8Array(maximumBytes));
			else if (chunk === 1) controller.enqueue(new Uint8Array(1));
			else controller.close();
			chunk += 1;
		},
	}));
}

describe("HTTP governed skill workload authority", function _DescribeAuthority()
{
	it("claims only an exact bounded database-issued workload response", async function _Claims()
	{
		const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(_Claim()), { status: 200 }));
		const authority = __CreateHttpSkillWorkloadControllerAuthority(_Options(fetch));

		expect(await authority.__Claim(new AbortController().signal)).toEqual(_Claim());
		expect(fetch).toHaveBeenCalledWith(new URL("http://opencrane-server.silo-a.svc.cluster.local:3001/api/internal/agent-controller/skill-workloads:claim"), expect.objectContaining({ method: "POST", body: "{}" }));
	});

	it("binds an assignment response to the submitted workload and immutable Job UID", async function _Commits()
	{
		const command = { claimedAt: "2026-07-24T00:00:00.000Z", deliveryCount: 1, workloadUid: "job-uid-1", bootstrapReference: `skill-bootstrap-v1_${"a".repeat(64)}`, namespace: "opencrane-tools" };
		const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ outcome: "assigned", workloadId: "workload-1", workloadUid: "job-uid-1" }), { status: 200 }));
		const authority = __CreateHttpSkillWorkloadControllerAuthority(_Options(fetch));

		expect(await authority.__CommitAssignment("workload-1", command, new AbortController().signal)).toBe("assigned");
	});

	it("fails closed when the server claims a different Job UID", async function _RejectsMismatchedAssignment()
	{
		const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ outcome: "assigned", workloadId: "workload-1", workloadUid: "other-job" }), { status: 200 }));
		const authority = __CreateHttpSkillWorkloadControllerAuthority(_Options(fetch));

		await expect(authority.__CommitAssignment("workload-1", { claimedAt: "2026-07-24T00:00:00.000Z", deliveryCount: 1, workloadUid: "job-uid-1", bootstrapReference: `skill-bootstrap-v1_${"a".repeat(64)}`, namespace: "opencrane-tools" }, new AbortController().signal)).rejects.toThrow(/mismatched/);
	});

	it("identifies invalid authority JSON before claim validation", async function _RejectsInvalidJson()
	{
		const authority = __CreateHttpSkillWorkloadControllerAuthority(_Options(vi.fn().mockResolvedValue(new Response("{", { status: 200 }))));

		await expect(authority.__Claim(new AbortController().signal)).rejects.toThrow(/OpenCrane skill workload response must contain valid JSON/);
	});

	it("delegates malformed claim and release models to the contract validators", async function _RejectsMalformedModels()
	{
		const malformedClaim = __CreateHttpSkillWorkloadControllerAuthority(_Options(vi.fn().mockResolvedValue(new Response(JSON.stringify({ ..._Claim(), skillRevisionId: "" }), { status: 200 }))));
		await expect(malformedClaim.__Claim(new AbortController().signal)).rejects.toThrow(/skill workload claim\.skillRevisionId must be a bounded identifier/);

		const release = { workloadId: "workload-1", siloId: "silo-a", kind: "authoring", workloadUid: "job-uid-1", releaseClaimedAt: "2026-07-24T00:00:30.000Z", releaseDeliveryCount: 1, expiresAt: "2026-07-24T00:01:00Z" };
		const malformedRelease = __CreateHttpSkillWorkloadControllerAuthority(_Options(vi.fn().mockResolvedValue(new Response(JSON.stringify(release), { status: 200 }))));
		await expect(malformedRelease.__ClaimRelease(new AbortController().signal)).rejects.toThrow(/skill workload release claim\.expiresAt must be a UTC millisecond instant/);
	});

	it("stops a chunked response as soon as it crosses the allocation ceiling", async function _BoundsChunkedResponse()
	{
		const authority = __CreateHttpSkillWorkloadControllerAuthority(_Options(vi.fn().mockResolvedValue(_OversizedChunkedResponse(16 * 1024))));

		await expect(authority.__Claim(new AbortController().signal)).rejects.toThrow(/exceeded the 16 KiB boundary/);
	});
});
