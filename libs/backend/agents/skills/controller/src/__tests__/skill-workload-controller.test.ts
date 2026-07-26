import type { V1Job } from "@kubernetes/client-node";
import { type Logger } from "@opencrane/observability";
import { describe, expect, it } from "vitest";

import { __ReconcileNextSkillWorkload, __ReconcileNextSkillWorkloadRelease, __RunSkillWorkloadController, __ValidateSkillWorkloadControllerProfiles } from "../skill-workload-controller.js";
import type { SkillWorkloadControllerAuthority, SkillWorkloadControllerKubernetesStore, SkillWorkloadControllerOptions } from "../skill-workload-controller.types.js";

/** Silent structured logger used by focused reconciliation tests. */
const _Log = { info: function _Info() {}, error: function _Error() {} } as unknown as Logger;

/** Return the two fixed workload-class profiles required by the controller. */
function _Profiles()
{
	return {
		authoring: { kind: "authoring" as const, image: `ghcr.io/opencrane/skill-authoring@sha256:${"a".repeat(64)}`, imagePullPolicy: "IfNotPresent" as const, serverNamespace: "opencrane", namespace: "opencrane-skill-authoring", serviceAccountName: "skill-authoring-default", capabilityTokenAudience: "opencrane-skill-authoring", scratchSize: "64Mi", activeDeadlineSeconds: 300, ttlSecondsAfterFinished: 0, resources: { requests: { cpu: "100m", memory: "128Mi" }, limits: { cpu: "500m", memory: "256Mi" } } },
		"tool-runner": { kind: "tool-runner" as const, image: `ghcr.io/opencrane/tool-runner@sha256:${"b".repeat(64)}`, imagePullPolicy: "IfNotPresent" as const, serverNamespace: "opencrane", namespace: "opencrane-tools", serviceAccountName: "tool-runner-default", capabilityTokenAudience: "opencrane-tool-runner", scratchSize: "64Mi", activeDeadlineSeconds: 300, ttlSecondsAfterFinished: 0, resources: { requests: { cpu: "100m", memory: "128Mi" }, limits: { cpu: "500m", memory: "256Mi" } } },
	};
}

/** Return one database-fenced authoring workload claim. */
function _Claim()
{
	return { workloadId: "workload_1", siloId: "silo-a", kind: "authoring" as const, skillRevisionId: "revision-1", claimedAt: "2026-07-24T00:00:00.000Z", deliveryCount: 2, expiresAt: "2026-07-24T00:00:30.000Z" };
}

/** Compose an authority with fail-fast defaults for operations a test does not use. */
function _Authority(overrides: Partial<SkillWorkloadControllerAuthority>): SkillWorkloadControllerAuthority
{
	return { async __Claim() { return null; }, async __CommitAssignment() { throw new Error("unexpected assignment commit"); }, async __ClaimRelease() { return null; }, async __CommitRelease() { throw new Error("unexpected release commit"); }, async __RegisterFirstPod() { throw new Error("unexpected Pod registration"); }, ...overrides };
}

/** Compose a Kubernetes port with a fail-fast default. */
function _Kubernetes(overrides: Partial<SkillWorkloadControllerKubernetesStore>): SkillWorkloadControllerKubernetesStore
{
	return { async __EnsureSuspendedJob() { throw new Error("unexpected Job"); }, async __EnsureSkillJobReleased() { throw new Error("unexpected Job release"); }, async __FindFirstSkillWorkloadPod() { throw new Error("unexpected Pod lookup"); }, ...overrides };
}

/** Compose reconciler options from focused fake ports. */
function _Options(authority: SkillWorkloadControllerAuthority, kubernetes: SkillWorkloadControllerKubernetesStore): SkillWorkloadControllerOptions
{
	return { authority, kubernetes, profiles: _Profiles(), pollIntervalMilliseconds: 1_000, log: _Log };
}

describe("governed skill workload controller", function _DescribeController()
{
	it("creates a suspended Job and atomically binds its API-issued UID and opaque bootstrap reference", async function _AssignsSuspendedJob()
	{
		const calls: string[] = [];
		let committed: unknown = null;
		let expected: V1Job | null = null;
		const authority = _Authority({ async __Claim() { calls.push("claim"); return _Claim(); }, async __CommitAssignment(_workloadId, command) { calls.push("commit"); committed = command; return "assigned"; } });
		const kubernetes = _Kubernetes({ async __EnsureSuspendedJob(job) { calls.push("job"); expected = job; return { ...job, metadata: { ...job.metadata, uid: "job-uid-1" } }; } });

		const result = await __ReconcileNextSkillWorkload(_Options(authority, kubernetes), new AbortController().signal);

		const built = expected as unknown as V1Job;
		expect(calls).toEqual(["claim", "job", "commit"]);
		expect(built.spec?.suspend).toBe(true);
		expect(built.metadata?.namespace).toBe("opencrane-skill-authoring");
		expect(built.metadata?.annotations?.["opencrane.ai/capability-reference"]).toMatch(/^skill-bootstrap-v1_[a-f0-9]{64}$/);
		expect(committed).toEqual({ claimedAt: _Claim().claimedAt, deliveryCount: 2, workloadUid: "job-uid-1", bootstrapReference: built.metadata?.annotations?.["opencrane.ai/capability-reference"], namespace: built.metadata?.namespace });
		expect(result).toEqual({ outcome: "assigned", workloadId: "workload_1", workloadUid: "job-uid-1" });
	});

	it("does no Kubernetes work when no fenced workload is ready", async function _IsIdle()
	{
		let jobs = 0;
		const kubernetes = _Kubernetes({ async __EnsureSuspendedJob() { jobs += 1; throw new Error("unexpected Job"); } });

		expect(await __ReconcileNextSkillWorkload(_Options(_Authority({}), kubernetes), new AbortController().signal)).toEqual({ outcome: "idle" });
		expect(jobs).toBe(0);
	});

	it("fails closed without committing when Kubernetes does not issue an immutable UID", async function _RequiresUid()
	{
		let commits = 0;
		const authority = _Authority({ async __Claim() { return _Claim(); }, async __CommitAssignment() { commits += 1; return "assigned"; } });
		const kubernetes = _Kubernetes({ async __EnsureSuspendedJob(job) { return job; } });

		await expect(__ReconcileNextSkillWorkload(_Options(authority, kubernetes), new AbortController().signal)).rejects.toThrow(/immutable UID/);
		expect(commits).toBe(0);
	});

	it("rejects incomplete or class-mismatched deployment profiles before polling", function _RejectsProfiles()
	{
		expect(function _MissingRunner() { __ValidateSkillWorkloadControllerProfiles({ authoring: _Profiles().authoring }); }).toThrow(/exactly authoring and tool-runner/);
		expect(function _WrongKind() { __ValidateSkillWorkloadControllerProfiles({ ..._Profiles(), authoring: { ..._Profiles().authoring, kind: "tool-runner" } }); }).toThrow(/wrong workload class/);
	});

	it("releases only the durable Job UID then records its uniquely selected first Pod", async function _ReleasesAndRegistersFirstPod()
	{
		const claim = { workloadId: "workload_1", siloId: "silo-a", kind: "authoring" as const, workloadUid: "job-uid-1", releaseClaimedAt: "2026-07-24T00:01:00.000Z", releaseDeliveryCount: 1, expiresAt: "2026-07-24T00:01:30.000Z" };
		const authority = _Authority({ async __ClaimRelease() { return claim; }, async __CommitRelease() { return "released"; }, async __RegisterFirstPod() { return "registered"; } });
		const kubernetes = _Kubernetes({ async __EnsureSkillJobReleased(job) { return { ...job, metadata: { ...job.metadata, uid: "job-uid-1" }, spec: { ...job.spec!, suspend: false } }; }, async __FindFirstSkillWorkloadPod(job, workloadUid, serviceAccountName) { const name = job.metadata?.name; const namespace = job.metadata?.namespace; if (!name || !namespace) throw new Error("test Job must have coordinates"); return { metadata: { uid: "pod-uid-1", namespace, labels: { ...job.spec?.template.metadata?.labels, "batch.kubernetes.io/controller-uid": workloadUid, "batch.kubernetes.io/job-name": name, "controller-uid": workloadUid, "job-name": name }, ownerReferences: [{ apiVersion: "batch/v1", kind: "Job", name, uid: workloadUid, controller: true }] }, spec: { serviceAccountName, containers: [] } }; } });

		expect(await __ReconcileNextSkillWorkloadRelease(_Options(authority, kubernetes), new AbortController().signal)).toEqual({ outcome: "registered", workloadId: "workload_1", workloadUid: "job-uid-1", podUid: "pod-uid-1" });
	});

	it("stops an idle poll promptly when shutdown interrupts its pending wait", async function _StopsIdlePollOnAbort()
	{
		const controller = new AbortController();
		const authority = _Authority({ async __Claim() { setTimeout(function _AbortIdlePoll() { controller.abort(); }, 0); return null; } });

		await expect(__RunSkillWorkloadController({ ..._Options(authority, _Kubernetes({})), pollIntervalMilliseconds: 60_000 }, controller.signal)).resolves.toBeUndefined();
	});
});
