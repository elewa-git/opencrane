import type { AgentControllerRunAttemptAssignmentCommand, AgentControllerRunWorkloadRegistrationCommand } from "@opencrane/contracts";
import { describe, expect, it } from "vitest";

import { __CreateHttpAgentControllerAuthority } from "../http-agent-controller-authority.js";
import type { AgentControllerFetch } from "../http-agent-controller-authority.types.js";

/** One exact claim response returned by the OpenCrane authority. */
function _ClaimBody()
{
	return {
		lease: { eventId: "event/1", claimedAt: "2026-07-20T00:00:00.000Z", deliveryCount: 1, expiresAt: "2026-07-20T00:01:00.000Z" },
		attempt: { runId: "run-1", attempt: 1, siloId: "silo-1", agentServiceId: "service-1", agentRevisionId: "revision-1", inputSnapshotDigest: "sha256:snapshot", namespace: "silo-a-runtime", workloadProfile: "personal-default", bootstrapReference: "bootstrap-ref-1", litellmKey: "sk-attempt-transient" },
	};
}

/** Exact assignment command echoed by the commit endpoint. */
function _Assignment(): AgentControllerRunAttemptAssignmentCommand
{
	return { claimedAt: "2026-07-20T00:00:00.000Z", deliveryCount: 1, runId: "run-1", attempt: 1, expectedWorkloadProfile: "personal-default", bootstrapReference: "bootstrap-ref-1", namespace: "silo-a-runtime", serviceAccountName: "agent-runtime-default", workloadUid: "job-uid" };
}

/** One exact workload-release claim returned by the OpenCrane authority. */
function _ReleaseBody()
{
	return {
		lease: { eventId: "release/1", claimedAt: "2026-07-20T00:02:00.000Z", deliveryCount: 2, expiresAt: "2026-07-20T00:03:00.000Z" },
		workload: { runId: "run-1", attempt: 1, siloId: "silo-1", agentServiceId: "service-1", agentRevisionId: "revision-1", namespace: "silo-a-runtime", serviceAccountName: "agent-runtime-default", workloadUid: "job-uid", workloadProfile: "personal-default", assignmentExpiresAt: "2026-07-20T01:00:00.000Z", bootstrapReference: "bootstrap-ref-1" },
	};
}

/** Exact first-Pod evidence submitted to the registration endpoint. */
function _Registration(): AgentControllerRunWorkloadRegistrationCommand
{
	return { claimedAt: "2026-07-20T00:02:00.000Z", deliveryCount: 2, runId: "run-1", attempt: 1, siloId: "silo-1", agentServiceId: "service-1", agentRevisionId: "revision-1", namespace: "silo-a-runtime", serviceAccountName: "agent-runtime-default", workloadUid: "job-uid", workloadProfile: "personal-default", bootstrapReference: "bootstrap-ref-1", podUid: "pod-uid" };
}

/** Return a chunked response that crosses the controller allocation ceiling. */
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

describe("agent-controller OpenCrane HTTP authority", function _Suite()
{
	it("claims and commits over the exact projected-token-authenticated routes", async function _CallsAuthority()
	{
		const requests: Array<{ readonly url: string; readonly init: RequestInit | undefined }> = [];
		const fetchRequest: AgentControllerFetch = async function _fetch(input, init)
		{
			requests.push({ url: String(input), init });
			if (String(input).endsWith("run-attempts:claim")) return new Response(JSON.stringify(_ClaimBody()), { status: 200 });
			return new Response(JSON.stringify({ outcome: "assigned", runId: "run-1", attempt: 1, workloadUid: "job-uid" }), { status: 200 });
		};
		const authority = __CreateHttpAgentControllerAuthority({ openCraneInternalUrl: "http://opencrane-server.silo-a.svc.cluster.local:3001", tokenPath: "/token", requestTimeoutMilliseconds: 5_000, fetch: fetchRequest, readToken: async function _token() { return "rotated-token"; } });

		expect(await authority.__Claim(new AbortController().signal)).toEqual(_ClaimBody());
		expect(await authority.__CommitAssignment("event/1", _Assignment(), new AbortController().signal)).toEqual({ outcome: "assigned", runId: "run-1", attempt: 1, workloadUid: "job-uid" });
		expect(requests.map(request => [request.init?.method, request.url])).toEqual([
			["POST", "http://opencrane-server.silo-a.svc.cluster.local:3001/api/internal/agent-controller/run-attempts:claim"],
			["PUT", "http://opencrane-server.silo-a.svc.cluster.local:3001/api/internal/agent-controller/run-attempts/event%2F1/assignment"],
		]);
		expect(new Headers(requests[0]?.init?.headers).get("authorization")).toBe("Bearer rotated-token");
		expect(requests[1]?.init?.body).toBe(JSON.stringify(_Assignment()));
	});

	it("claims releases and registers first-Pod evidence on the exact routes", async function _CallsReleaseAuthority()
	{
		const requests: Array<{ readonly url: string; readonly init: RequestInit | undefined }> = [];
		const fetchRequest: AgentControllerFetch = async function _fetch(input, init)
		{
			requests.push({ url: String(input), init });
			if (String(input).endsWith("workload-releases:claim")) return new Response(JSON.stringify(_ReleaseBody()), { status: 200 });
			return new Response(JSON.stringify({ outcome: "registered", runId: "run-1", attempt: 1, workloadUid: "job-uid", podUid: "pod-uid" }), { status: 200 });
		};
		const authority = __CreateHttpAgentControllerAuthority({ openCraneInternalUrl: "http://opencrane-server.silo-a.svc.cluster.local:3001", tokenPath: "/token", requestTimeoutMilliseconds: 5_000, fetch: fetchRequest, readToken: async function _token() { return "rotated-token"; } });

		expect(await authority.__ClaimWorkloadRelease(new AbortController().signal)).toEqual(_ReleaseBody());
		expect(await authority.__RegisterFirstPod("release/1", _Registration(), new AbortController().signal)).toEqual({ outcome: "registered", runId: "run-1", attempt: 1, workloadUid: "job-uid", podUid: "pod-uid" });
		expect(requests.map(request => [request.init?.method, request.url])).toEqual([
			["POST", "http://opencrane-server.silo-a.svc.cluster.local:3001/api/internal/agent-controller/workload-releases:claim"],
			["PUT", "http://opencrane-server.silo-a.svc.cluster.local:3001/api/internal/agent-controller/workload-releases/release%2F1/registration"],
		]);
		expect(requests[1]?.init?.body).toBe(JSON.stringify(_Registration()));
	});

	it("treats 204 as idle and rejects malformed or mismatched authority data", async function _FailsClosed()
	{
		const idle = __CreateHttpAgentControllerAuthority({ openCraneInternalUrl: "http://opencrane-server.silo-a.svc.cluster.local:3001", tokenPath: "/token", requestTimeoutMilliseconds: 5_000, fetch: async function _idle() { return new Response(null, { status: 204 }); }, readToken: async function _token() { return "token"; } });
		expect(await idle.__Claim(new AbortController().signal)).toBeNull();

		const malformed = __CreateHttpAgentControllerAuthority({ openCraneInternalUrl: "http://opencrane-server.silo-a.svc.cluster.local:3001", tokenPath: "/token", requestTimeoutMilliseconds: 5_000, fetch: async function _malformed() { return new Response(JSON.stringify({ lease: {}, attempt: {} }), { status: 200 }); }, readToken: async function _token() { return "token"; } });
		await expect(malformed.__Claim(new AbortController().signal)).rejects.toThrow(/controller claim\.lease\.eventId must be a bounded identifier/);
		const invalidJson = __CreateHttpAgentControllerAuthority({ openCraneInternalUrl: "http://opencrane-server.silo-a.svc.cluster.local:3001", tokenPath: "/token", requestTimeoutMilliseconds: 5_000, fetch: async function _invalidJson() { return new Response("{", { status: 200 }); }, readToken: async function _token() { return "token"; } });
		await expect(invalidJson.__Claim(new AbortController().signal)).rejects.toThrow(/OpenCrane controller response must contain valid JSON/);
		const malformedRelease = __CreateHttpAgentControllerAuthority({ openCraneInternalUrl: "http://opencrane-server.silo-a.svc.cluster.local:3001", tokenPath: "/token", requestTimeoutMilliseconds: 5_000, fetch: async function _malformedRelease() { return new Response(JSON.stringify({ ..._ReleaseBody(), workload: { ..._ReleaseBody().workload, assignmentExpiresAt: "2026-07-20T01:00:00Z" } }), { status: 200 }); }, readToken: async function _token() { return "token"; } });
		await expect(malformedRelease.__ClaimWorkloadRelease(new AbortController().signal)).rejects.toThrow(/workload-release claim\.workload\.assignmentExpiresAt must be a UTC millisecond instant/);

		const mismatched = __CreateHttpAgentControllerAuthority({ openCraneInternalUrl: "http://opencrane-server.silo-a.svc.cluster.local:3001", tokenPath: "/token", requestTimeoutMilliseconds: 5_000, fetch: async function _mismatched() { return new Response(JSON.stringify({ outcome: "assigned", runId: "other", attempt: 1, workloadUid: "job-uid" }), { status: 200 }); }, readToken: async function _token() { return "token"; } });
		await expect(mismatched.__CommitAssignment("event-1", _Assignment(), new AbortController().signal)).rejects.toThrow(/mismatched controller assignment/);

		const mismatchedPod = __CreateHttpAgentControllerAuthority({ openCraneInternalUrl: "http://opencrane-server.silo-a.svc.cluster.local:3001", tokenPath: "/token", requestTimeoutMilliseconds: 5_000, fetch: async function _mismatchedPod() { return new Response(JSON.stringify({ outcome: "registered", runId: "run-1", attempt: 1, workloadUid: "job-uid", podUid: "foreign-pod" }), { status: 200 }); }, readToken: async function _token() { return "token"; } });
		await expect(mismatchedPod.__RegisterFirstPod("event-1", _Registration(), new AbortController().signal)).rejects.toThrow(/mismatched first-Pod/);
	});

	it("stops a chunked response as soon as it crosses the allocation ceiling", async function _BoundsChunkedResponse()
	{
		const authority = __CreateHttpAgentControllerAuthority({ openCraneInternalUrl: "http://opencrane-server.silo-a.svc.cluster.local:3001", tokenPath: "/token", requestTimeoutMilliseconds: 5_000, fetch: async function _oversized() { return _OversizedChunkedResponse(64 * 1024); }, readToken: async function _token() { return "token"; } });

		await expect(authority.__Claim(new AbortController().signal)).rejects.toThrow(/exceeded the 64 KiB boundary/);
	});
});
