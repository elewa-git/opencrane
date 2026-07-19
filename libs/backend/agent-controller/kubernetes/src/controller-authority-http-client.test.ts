import { readFile } from "node:fs/promises";

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentJobProjection, DesiredAgentJob } from "@opencrane/backend/agent-controller";

import { _ControllerAuthorityHttpClient } from "./controller-authority-http-client.js";
import type { ControllerAuthorityHttpClientOptions } from "./controller-authority-http-client.types.js";

vi.mock("node:fs/promises", function _mockFileSystem()
{
	return { readFile: vi.fn() };
});

/** Construct a valid private controller desired-Job response. */
function _Desired(): DesiredAgentJob
{
	return { runId: "run-123", attempt: 1, agentServiceId: "service-123", agentRevisionId: "revision-123", siloId: "silo-123", subjectId: "subject-123", namespace: "opencrane-runtime", serviceAccountName: "agent-runtime", image: "ghcr.io/opencrane/agent-runtime@sha256:abc" };
}

/** Construct a private client with a deterministic injected HTTP transport. */
function _Client(fetch: typeof globalThis.fetch): _ControllerAuthorityHttpClient
{
	const options: ControllerAuthorityHttpClientOptions = { baseUrl: "http://opencrane.opencrane.svc.cluster.local:3000", tokenPath: "/var/run/opencrane/token", fetch };
	return new _ControllerAuthorityHttpClient(options);
}

/** Constructs an immutable controller Job projection for acknowledgement tests. */
function _Projection(image: string): AgentJobProjection
{
	return { name: "agent-run-run-123-a1", labels: {}, namespace: "opencrane-runtime", serviceAccountName: "agent-runtime", image, suspend: true, backoffLimit: 0, projectedTokenTtlSeconds: 600 };
}

/** Returns the test-controlled projected-token reader. */
function _ReadFile(): ReturnType<typeof vi.fn>
{
	return vi.mocked(readFile) as unknown as ReturnType<typeof vi.fn>;
}

describe("controller authority HTTP client", function _describeAuthorityClient()
{
	beforeEach(function _resetMocks()
	{
		vi.resetAllMocks();
	});

	it("reads a freshly rotated authority token for each exact private request", async function _readsFreshToken()
	{
		const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ desired: _Desired() }), { status: 200 })).mockResolvedValueOnce(new Response(null, { status: 204 })) as unknown as typeof globalThis.fetch;
		_ReadFile().mockResolvedValueOnce(" first-token ").mockResolvedValueOnce(" second-token ");
		const client = _Client(fetch);

		const desired = await client.readNext();
		await client.rejectDesired(desired!, "invalid_desired_job");

		expect(readFile).toHaveBeenNthCalledWith(1, "/var/run/opencrane/token", "utf8");
		expect(readFile).toHaveBeenNthCalledWith(2, "/var/run/opencrane/token", "utf8");
		expect(fetch).toHaveBeenNthCalledWith(1, new URL("/api/internal/agent-controller/desired", "http://opencrane.opencrane.svc.cluster.local:3000"), expect.objectContaining({ method: "GET", headers: { authorization: "Bearer first-token" } }));
		expect(fetch).toHaveBeenNthCalledWith(2, new URL("/api/internal/agent-controller/desired/reject", "http://opencrane.opencrane.svc.cluster.local:3000"), expect.objectContaining({ method: "POST", headers: { authorization: "Bearer second-token", "content-type": "application/json" }, body: JSON.stringify({ runId: "run-123", attempt: 1, reason: "invalid_desired_job" }) }));
	});

	it("sends only acknowledgement coordinates and requires an exact start decision", async function _acknowledgesExactCoordinates()
	{
		const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ bootstrapReady: false }), { status: 200 })).mockResolvedValueOnce(new Response(null, { status: 204 })) as unknown as typeof globalThis.fetch;
		_ReadFile().mockResolvedValue("controller-token");
		const client = _Client(fetch);
		const desired = _Desired();
		const projection = _Projection(desired.image);

		await expect(client.recordJob(desired, projection, "job-uid")).resolves.toEqual({ bootstrapReady: false });
		await expect(client.recordPod(desired, projection, "job-uid", "pod-uid")).resolves.toBeUndefined();

		expect(fetch).toHaveBeenNthCalledWith(1, new URL("/api/internal/agent-controller/workloads/job", "http://opencrane.opencrane.svc.cluster.local:3000"), expect.objectContaining({ body: JSON.stringify({ runId: "run-123", attempt: 1, workloadName: "agent-run-run-123-a1", workloadUid: "job-uid" }) }));
		expect(fetch).toHaveBeenNthCalledWith(2, new URL("/api/internal/agent-controller/workloads/pod", "http://opencrane.opencrane.svc.cluster.local:3000"), expect.objectContaining({ body: JSON.stringify({ runId: "run-123", attempt: 1, workloadName: "agent-run-run-123-a1", workloadUid: "job-uid", podUid: "pod-uid" }) }));
	});

	it("rejects malformed desired and acknowledgement responses", async function _rejectsMalformedResponses()
	{
		const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ desired: { runId: "run-123" } }), { status: 200 })).mockResolvedValueOnce(new Response(JSON.stringify({ bootstrapReady: "true" }), { status: 200 })) as unknown as typeof globalThis.fetch;
		_ReadFile().mockResolvedValue("controller-token");
		const client = _Client(fetch);
		const desired = _Desired();
		const projection = _Projection(desired.image);

		await expect(client.readNext()).rejects.toThrow("controller desired response is malformed");
		await expect(client.recordJob(desired, projection, "job-uid")).rejects.toThrow("controller Job acknowledgement returned an invalid start decision");
	});
});
