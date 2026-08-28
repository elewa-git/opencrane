import { describe, expect, it, vi } from "vitest";

import { RuntimeWorkloadClaimClasses } from "@opencrane/backend/agents/runtime/workloads/contract";
import { ArtifactPreprocessRecoveryReasons } from "@opencrane/backend/artifacts/preprocessor/workflows/contract";

import { __CreateHttpArtifactPreprocessControllerAuthority } from "../http-artifact-preprocess-authority";

/** Returns the task receipt that identifies one admitted PDF preprocessing workflow. */
function _Task()
{
	return { taskId: "task-1", taskName: "artifacts.preprocess.pdf-to-text/v1", idempotencyKey: "artifact-preprocess:preprocess-1" };
}

/** Returns the only server record a controller may use to create one PDF preprocessing Job. */
function _Record()
{
	return {
		preprocessJobId: "preprocess-1",
		siloId: "silo-1",
		claim: {
			claimId: "claim-1",
			siloId: "silo-1",
			workloadClass: RuntimeWorkloadClaimClasses.ArtifactPreprocess,
			profileName: "pdf-preprocessor",
			idempotencyKey: "artifact-preprocess:preprocess-1",
			claimedAt: "2026-08-25T10:00:00.000Z",
			deliveryCount: 1,
			expiresAt: "2026-08-25T10:05:00.000Z",
			executionReference: "preprocess-1",
		},
	};
}

/** Builds one HTTP authority with a controlled token reader and fetch exchange. */
function _Authority(response: Response)
{
	const fetch = vi.fn().mockResolvedValue(response);
	const authority = __CreateHttpArtifactPreprocessControllerAuthority({
		openCraneInternalUrl: "http://opencrane.opencrane.svc.cluster.local",
		serverServiceName: "opencrane",
		serverNamespace: "opencrane",
		tokenPath: "/var/run/opencrane/controller.token",
		requestTimeoutMilliseconds: 1_000,
		fetch,
		async readToken()
		{
			return "controller-token";
		},
	});
	return { authority, fetch };
}

describe("artifact preprocessing controller HTTP authority", function _DescribeArtifactPreprocessControllerHttpAuthority()
{
	it("rejects an origin that does not name the configured OpenCrane Service before reading its token", function _RejectsUntrustedOrigin()
	{
		expect(function _CreateUntrustedAuthority()
		{
			return __CreateHttpArtifactPreprocessControllerAuthority({ openCraneInternalUrl: "http://example.invalid", serverServiceName: "opencrane", serverNamespace: "opencrane", tokenPath: "/var/run/opencrane/controller.token", requestTimeoutMilliseconds: 1_000 });
		}).toThrow(/in-cluster HTTP origin/);
	});

	it("returns only the server record that matches the requested preprocessing job", async function _ClaimsTask()
	{
		const { authority, fetch } = _Authority(new Response(JSON.stringify(_Record()), { status: 200, headers: { "content-type": "application/json" } }));

		await expect(authority.claimForTask("preprocess-1", _Task())).resolves.toMatchObject(_Record());

		const request = fetch.mock.calls[0]?.[0] as URL;
		const init = fetch.mock.calls[0]?.[1] as RequestInit;
		expect(request.pathname).toBe("/api/internal/agent-controller/artifact-preprocess-jobs/preprocess-1/claim");
		expect(new Headers(init.headers).get("authorization")).toBe("Bearer controller-token");
	});

	it("maps a stale task response to no claim", async function _HandlesStaleTask()
	{
		const { authority } = _Authority(new Response(null, { status: 409 }));

		await expect(authority.claimForTask("preprocess-1", _Task())).resolves.toBeNull();
	});

	it("rejects a successful response that selected another preprocessing job", async function _RejectsMismatchedJob()
	{
		const { authority } = _Authority(new Response(JSON.stringify({ ..._Record(), preprocessJobId: "preprocess-2" }), { status: 200, headers: { "content-type": "application/json" } }));

		await expect(authority.claimForTask("preprocess-1", _Task())).rejects.toThrow(/selected another job/);
	});

	it("sends the fenced workload binding and maps a stale response to conflict", async function _BindsWorkload()
	{
		const bound = _Authority(new Response(JSON.stringify({ outcome: "bound", preprocessJobId: "preprocess-1" }), { status: 200, headers: { "content-type": "application/json" } }));
		const command = { binding: { claimId: "claim-1", claimedAt: "2026-08-25T10:00:00.000Z", deliveryCount: 1, profileName: "pdf-preprocessor", workloadUid: "job-uid-1" }, bootstrapReference: "artifact-preprocess-bootstrap-v1_abcdef", namespace: "opencrane-artifact-preprocessor" };

		await expect(bound.authority.bindWorkload("preprocess-1", _Task(), command)).resolves.toBe("bound");
		expect(bound.fetch.mock.calls[0]?.[0]).toMatchObject({ pathname: "/api/internal/agent-controller/artifact-preprocess-jobs/preprocess-1/workload-binding" });

		const conflict = _Authority(new Response(null, { status: 409 }));
		await expect(conflict.authority.bindFirstPod("preprocess-1", _Task(), { binding: { ...command.binding, firstPodUid: "pod-uid-1" } })).resolves.toBe("conflict");
	});

	it("rejects a persisted outcome for another delivery", async function _RejectsMismatchedOutcome()
	{
		const returnedDigest = `sha256:${"b".repeat(64)}`;
		const { authority } = _Authority(new Response(JSON.stringify({ kind: "completed", preprocessJobId: "preprocess-1", deliveryCount: 2, completionDigest: returnedDigest }), { status: 200, headers: { "content-type": "application/json" } }));

		await expect(authority.loadOutcome("preprocess-1", 1, _Task())).rejects.toThrow(/outcome response selected another delivery/);
	});

	it("sends the exact controller recovery binding and reason", async function _RecordsRecoveryFailure()
	{
		const outcome = { kind: "terminal_failed", preprocessJobId: "preprocess-1", deliveryCount: 1 };
		const { authority, fetch } = _Authority(new Response(JSON.stringify(outcome), { status: 200, headers: { "content-type": "application/json" } }));
		const command = { binding: { claimId: "claim-1", claimedAt: "2026-08-25T10:00:00.000Z", deliveryCount: 1, profileName: "pdf-preprocessor", workloadUid: "job-uid-1", firstPodUid: "pod-uid-1" }, reason: ArtifactPreprocessRecoveryReasons.JobTerminalWithoutOutcome };

		await expect(authority.recordUnreportedFailure("preprocess-1", _Task(), command)).resolves.toEqual(outcome);

		expect(fetch.mock.calls[0]?.[0]).toMatchObject({ pathname: "/api/internal/agent-controller/artifact-preprocess-jobs/preprocess-1/recovery/failure" });
		expect(JSON.parse(String((fetch.mock.calls[0]?.[1] as RequestInit).body))).toEqual({ task: _Task(), ...command });
	});
});
