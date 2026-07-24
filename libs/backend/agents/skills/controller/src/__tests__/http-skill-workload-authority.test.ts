import { describe, expect, it, vi } from "vitest";

import { __CreateHttpSkillWorkloadControllerAuthority } from "../http-skill-workload-authority.js";

/** Return complete fixed adapter options with replaceable request seams. */
function _Options(fetch: typeof globalThis.fetch)
{
	return { openCraneInternalUrl: "http://opencrane-server.silo-a.svc.cluster.local:3001", tokenPath: "/var/run/opencrane/tokens/opencrane.token", requestTimeoutMilliseconds: 1_000, fetch, readToken: vi.fn().mockResolvedValue("projected-token") };
}

/** Return one exact database-fenced skill workload claim response. */
function _Claim()
{
	return { workloadId: "workload-1", siloId: "silo-a", kind: "authoring", skillRevisionId: "revision-1", claimedAt: "2026-07-24T00:00:00.000Z", deliveryCount: 1, expiresAt: "2026-07-24T00:00:30.000Z" };
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
		const command = { claimedAt: "2026-07-24T00:00:00.000Z", deliveryCount: 1, workloadUid: "job-uid-1", bootstrapReference: `skill-bootstrap-v1_${"a".repeat(64)}` };
		const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ outcome: "assigned", workloadId: "workload-1", workloadUid: "job-uid-1" }), { status: 200 }));
		const authority = __CreateHttpSkillWorkloadControllerAuthority(_Options(fetch));

		expect(await authority.__CommitAssignment("workload-1", command, new AbortController().signal)).toBe("assigned");
	});

	it("fails closed when the server claims a different Job UID", async function _RejectsMismatchedAssignment()
	{
		const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ outcome: "assigned", workloadId: "workload-1", workloadUid: "other-job" }), { status: 200 }));
		const authority = __CreateHttpSkillWorkloadControllerAuthority(_Options(fetch));

		await expect(authority.__CommitAssignment("workload-1", { claimedAt: "2026-07-24T00:00:00.000Z", deliveryCount: 1, workloadUid: "job-uid-1", bootstrapReference: `skill-bootstrap-v1_${"a".repeat(64)}` }, new AbortController().signal)).rejects.toThrow(/mismatched/);
	});
});
