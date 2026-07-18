import { describe, expect, it } from "vitest";

import { __ReconcileAgentJob, _BuildJobProjection } from "./agent-controller.js";
import type { AgentControllerDependencies, AgentJobProjection, DesiredAgentJob, ObservedAgentJob } from "./agent-controller.types.js";

/** Construct one target-shaped desired Job for controller tests. */
function _Desired(): DesiredAgentJob
{
	return { runId: "run-123", attempt: 1, agentServiceId: "service-123", agentRevisionId: "revision-123", siloId: "silo-123", subjectId: "user-123", namespace: "opencrane-runtime", serviceAccountName: "agent-runtime", image: "ghcr.io/opencrane/agent-runtime@sha256:abc" };
}

/** Construct isolated fake dependencies while recording the security-relevant call order. */
function _Dependencies(desired: DesiredAgentJob | null, observed: ObservedAgentJob | null = null, bootstrapReady = true, createdSuspended = true): { readonly dependencies: AgentControllerDependencies; readonly calls: string[] }
{
	const calls: string[] = [];
	return {
		calls,
		dependencies: {
			policy: { runtimeNamespace: "opencrane-runtime", runtimeServiceAccountName: "agent-runtime", runtimeImage: "ghcr.io/opencrane/agent-runtime@sha256:abc" },
			desiredJobs: { async readNext() { return desired; } },
			jobs: {
				async get() { calls.push("get"); return observed; },
				async createSuspended(projection: AgentJobProjection) { calls.push("create"); return { name: projection.name, labels: projection.labels, uid: "job-uid", suspended: createdSuspended }; },
				async delete(_: AgentJobProjection, uid: string) { calls.push(`delete:${uid}`); },
				async unsuspend(_: AgentJobProjection, uid: string) { calls.push(`unsuspend:${uid}`); },
				async firstPodUid() { calls.push("pod"); return "pod-uid"; },
			},
			status: {
				async rejectDesired(_: DesiredAgentJob, reason: "invalid_desired_job" | "unsafe_existing_job") { calls.push(`reject:${reason}`); },
				async recordJob(_: DesiredAgentJob, __: AgentJobProjection, uid: string) { calls.push(`job:${uid}`); return { bootstrapReady }; },
				async recordPod(_: DesiredAgentJob, __: AgentJobProjection, ___: string, uid: string) { calls.push(`pod:${uid}`); },
			},
		},
	};
}

describe("agent workload controller", function _describeController()
{
	it("creates suspended, records its UID, then unsuspends and records the first Pod", async function _createsInOrder()
	{
		const fixture = _Dependencies(_Desired());
		await expect(__ReconcileAgentJob(fixture.dependencies)).resolves.toEqual({ outcome: "reconciled", runId: "run-123", attempt: 1, workloadUid: "job-uid", podUid: "pod-uid" });
		expect(fixture.calls).toEqual(["get", "create", "job:job-uid", "unsuspend:job-uid", "pod", "pod:pod-uid"]);
	});

	it("recovers a matching running Job only after authority re-confirms bootstrap readiness", async function _doesNotCreateAgain()
	{
		const fixture = _Dependencies(_Desired(), { name: _BuildJobProjection(_Desired()).name, labels: _BuildJobProjection(_Desired()).labels, uid: "job-uid", suspended: false });
		await __ReconcileAgentJob(fixture.dependencies);
		expect(fixture.calls).toEqual(["get", "job:job-uid", "pod", "pod:pod-uid"]);
	});

	it("rejects a desired Job that widens the approved image boundary", async function _rejectsImage()
	{
		const desired = { ..._Desired(), image: "ghcr.io/untrusted/image:latest" };
		const fixture = _Dependencies(desired);
		await expect(__ReconcileAgentJob(fixture.dependencies)).resolves.toEqual({ outcome: "rejected", reason: "invalid_desired_job", runId: "run-123", attempt: 1 });
		expect(fixture.calls).toEqual(["reject:invalid_desired_job"]);
	});

	it("keeps a Job suspended until the authority confirms UID-bound bootstrap delivery", async function _keepsPrepared()
	{
		const fixture = _Dependencies(_Desired(), null, false);
		await expect(__ReconcileAgentJob(fixture.dependencies)).resolves.toEqual({ outcome: "prepared", runId: "run-123", attempt: 1, workloadUid: "job-uid" });
		expect(fixture.calls).toEqual(["get", "create", "job:job-uid"]);
	});

	it("deletes and rejects an already-running Job before it can run without bootstrap acknowledgement", async function _rejectsUnsafeExistingJob()
	{
		const fixture = _Dependencies(_Desired(), { name: _BuildJobProjection(_Desired()).name, labels: _BuildJobProjection(_Desired()).labels, uid: "job-uid", suspended: false }, false);
		await expect(__ReconcileAgentJob(fixture.dependencies)).resolves.toEqual({ outcome: "rejected", reason: "unsafe_existing_job", runId: "run-123", attempt: 1 });
		expect(fixture.calls).toEqual(["get", "job:job-uid", "delete:job-uid", "reject:unsafe_existing_job"]);
	});

	it("deletes a creation result that violates the initial suspended invariant", async function _rejectsUnexpectedCreation()
	{
		const fixture = _Dependencies(_Desired(), null, true, false);
		await expect(__ReconcileAgentJob(fixture.dependencies)).resolves.toEqual({ outcome: "rejected", reason: "unsafe_existing_job", runId: "run-123", attempt: 1 });
		expect(fixture.calls).toEqual(["get", "create", "delete:job-uid", "reject:unsafe_existing_job"]);
	});

	it("keeps the Kubernetes projection deterministic and retry-distinct", function _buildsProjection()
	{
		expect(_BuildJobProjection(_Desired())).toMatchObject({ name: expect.stringMatching(/^agent-run-run-123-[a-f0-9]{16}-a1$/), suspend: true, backoffLimit: 0, serviceAccountName: "agent-runtime" });
		expect(_BuildJobProjection({ ..._Desired(), attempt: 2 }).name).not.toBe(_BuildJobProjection(_Desired()).name);
	});

	it("bounds deterministic Job names and rejects IDs unsafe for Kubernetes labels", async function _boundsKubernetesFields()
	{
		const longRunId = "r".repeat(63);
		expect(_BuildJobProjection({ ..._Desired(), runId: longRunId, attempt: 9_999_999_999 }).name).toHaveLength(63);
		const fixture = _Dependencies({ ..._Desired(), agentRevisionId: "revision/unsafe" });
		await expect(__ReconcileAgentJob(fixture.dependencies)).resolves.toEqual({ outcome: "rejected", reason: "invalid_desired_job", runId: "run-123", attempt: 1 });
	});

	it("does not collide long run names that share an initial Kubernetes-safe prefix", function _avoidsLongNameCollision()
	{
		const common = "r".repeat(50);
		expect(_BuildJobProjection({ ..._Desired(), runId: `${common}aaaaaaaaaaaaa` }).name).not.toBe(_BuildJobProjection({ ..._Desired(), runId: `${common}bbbbbbbbbbbbb` }).name);
	});

	it("refuses a same-name Job whose immutable run labels do not match the desired projection", async function _refusesMismatchedJob()
	{
		const fixture = _Dependencies(_Desired(), { name: _BuildJobProjection(_Desired()).name, labels: { "opencrane.io/run-id": "other-run" }, uid: "other-job", suspended: true });
		await expect(__ReconcileAgentJob(fixture.dependencies)).resolves.toEqual({ outcome: "rejected", reason: "mismatched_existing_job", runId: "run-123", attempt: 1 });
		expect(fixture.calls).toEqual(["get"]);
	});
});
