import type { V1Job, V1Pod, V1Secret } from "@kubernetes/client-node";
import { ___GetContext, type Logger } from "@opencrane/observability";
import type { AgentControllerRunAttemptAssignmentCommand, AgentControllerRunAttemptClaim, AgentControllerRunWorkloadRegistrationCommand, AgentControllerRunWorkloadReleaseClaim } from "@opencrane/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import { __ReconcileNextAgentRuntimeAttempt, __ReconcileNextRuntimeRelease, __RunAgentController, __ValidateAgentControllerRuntimeProfiles } from "../agent-controller.js";
import type { AgentControllerAuthority, AgentControllerKubernetesStore, AgentControllerOptions, AgentControllerRuntimeProfiles } from "../agent-controller.types.js";

/** Silent structured logger used by orchestration tests. */
const _log = { info: function _info() {}, error: function _error() {} } as unknown as Logger;

/** Return one exact configured runtime profile. */
function _Profiles(): AgentControllerRuntimeProfiles
{
	return {
		"personal-default": {
			image: "ghcr.io/elewa-git/opencrane-agent-runtime@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
			imagePullPolicy: "IfNotPresent",
			runtimeStreamUrl: "http://opencrane-server.silo-a.svc.cluster.local:3001/api/internal/agent-runtime",
				litellmBaseUrl: "http://litellm.silo-a.svc.cluster.local:4000",
				serverNamespace: "silo-a",
				serviceAccountName: "agent-runtime-default",
			projectedTokenTtlSeconds: 600,
			scratchSize: "64Mi",
			activeDeadlineSeconds: 900,
			ttlSecondsAfterFinished: 0,
			resources: { requests: { cpu: "25m", memory: "64Mi" }, limits: { cpu: "250m", memory: "128Mi" } },
		},
	};
}

/** Return one durable authority claim. */
function _Claim(): AgentControllerRunAttemptClaim
{
	return {
		lease: { eventId: "event-1", claimedAt: "2026-07-20T00:00:00.000Z", deliveryCount: 2, expiresAt: "2026-07-20T00:01:00.000Z" },
		attempt: { runId: "run-1", attempt: 3, siloId: "silo-1", agentServiceId: "service-1", agentRevisionId: "revision-1", inputSnapshotDigest: "sha256:snapshot", namespace: "silo-a-runtime", workloadProfile: "personal-default", bootstrapReference: "bootstrap-ref-1", litellmKey: "sk-attempt-transient" },
	};
}

/** Return one durable workload-release claim for the assigned Job. */
function _ReleaseClaim(): AgentControllerRunWorkloadReleaseClaim
{
	return {
		lease: { eventId: "release-1", claimedAt: "2026-07-20T00:02:00.000Z", deliveryCount: 1, expiresAt: "2026-07-20T00:03:00.000Z" },
		workload: { runId: "run-1", attempt: 3, siloId: "silo-1", agentServiceId: "service-1", agentRevisionId: "revision-1", namespace: "silo-a-runtime", serviceAccountName: "agent-runtime-default", workloadUid: "job-uid-1", workloadProfile: "personal-default", assignmentExpiresAt: "2026-07-20T00:25:00.000Z", bootstrapReference: "bootstrap-ref-1" },
	};
}

/** Compose a complete authority with fail-fast defaults for operations a test does not use. */
function _Authority(overrides: Partial<AgentControllerAuthority>): AgentControllerAuthority
{
	return {
		async __Claim() { return null; },
		async __CommitAssignment() { throw new Error("unexpected assignment commit"); },
		async __ClaimWorkloadRelease() { return null; },
		async __RegisterFirstPod() { throw new Error("unexpected Pod registration"); },
		...overrides,
	};
}

/** Compose a complete Kubernetes port with fail-fast defaults for unused operations. */
function _Kubernetes(overrides: Partial<AgentControllerKubernetesStore>): AgentControllerKubernetesStore
{
	return {
		async __EnsureSuspendedJob() { throw new Error("unexpected Job"); },
		async __EnsureAttemptKeySecret() { throw new Error("unexpected Secret"); },
		async __EnsureRuntimeJobReleased() { throw new Error("unexpected Job release"); },
		async __FindFirstRuntimePod() { throw new Error("unexpected Pod list"); },
		...overrides,
	};
}

/** Compose controller options from focused fake ports. */
function _Options(authority: AgentControllerAuthority, kubernetes: AgentControllerKubernetesStore): AgentControllerOptions
{
	return { authority, kubernetes, profiles: _Profiles(), runtimeNamespace: "silo-a-runtime", pollIntervalMilliseconds: 1_000, log: _log };
}

describe("agent-controller orchestration", function _Suite()
{
	afterEach(function _RestoreTimers()
	{
		vi.useRealTimers();
	});

	it("creates a suspended Job and commits only the API-issued UID", async function _AssignsSuspendedJob()
	{
		const calls: string[] = [];
		let committed: AgentControllerRunAttemptAssignmentCommand | null = null;
		let createdSecret: V1Secret | null = null;
		let jobName: string | undefined;
		const authority = _Authority({
			async __Claim() { calls.push("claim"); return _Claim(); },
			async __CommitAssignment(_eventId, command) { calls.push("commit"); committed = command; return { outcome: "assigned", runId: command.runId, attempt: command.attempt, workloadUid: command.workloadUid }; },
		});
		const kubernetes = _Kubernetes({
			async __EnsureSuspendedJob(expected: V1Job) { calls.push("job"); jobName = expected.metadata?.name; return { ...expected, metadata: { ...expected.metadata, uid: "job-uid-1" } }; },
			async __EnsureAttemptKeySecret(expected: V1Secret) { calls.push("secret"); createdSecret = expected; },
		});

		const result = await __ReconcileNextAgentRuntimeAttempt(_Options(authority, kubernetes), new AbortController().signal);

		// The Secret is created after the Job (so it can own it) and before the commit that lets the
		// separate release reconcile unsuspend the Job.
		expect(calls).toEqual(["claim", "job", "secret", "commit"]);
		const secret = createdSecret as unknown as V1Secret;
		expect(secret.immutable).toBe(true);
		expect(secret.stringData).toEqual({ key: "sk-attempt-transient" });
		expect(secret.metadata?.namespace).toBe("silo-a-runtime");
		expect(typeof secret.metadata?.name).toBe("string");
		// The Secret is owned by the exact suspended Job (its name + API-issued UID), so Kubernetes
		// garbage-collects it with the Job and no delete RBAC is needed.
		expect(secret.metadata?.ownerReferences).toEqual([{ apiVersion: "batch/v1", kind: "Job", name: jobName, uid: "job-uid-1", controller: true, blockOwnerDeletion: true }]);
		expect(JSON.stringify(committed)).not.toContain("sk-attempt-transient");
		expect(committed).toMatchObject({ claimedAt: _Claim().lease.claimedAt, deliveryCount: 2, runId: "run-1", attempt: 3, expectedWorkloadProfile: "personal-default", bootstrapReference: "bootstrap-ref-1", namespace: "silo-a-runtime", serviceAccountName: "agent-runtime-default", workloadUid: "job-uid-1" });
		expect(result).toEqual({ outcome: "assigned", eventId: "event-1", runId: "run-1", attempt: 3, workloadUid: "job-uid-1" });
	});

	it("does no Kubernetes work when OpenCrane has no desired attempt", async function _Idle()
	{
		const authority = _Authority({});
		const kubernetes = _Kubernetes({});
		expect(await __ReconcileNextAgentRuntimeAttempt(_Options(authority, kubernetes), new AbortController().signal)).toEqual({ outcome: "idle" });
	});

	it("fails closed before resource creation for another namespace or an unknown profile", async function _RejectsUnownedClaim()
	{
		let resourceCalls = 0;
		const kubernetes = _Kubernetes({ async __EnsureSuspendedJob(expected) { resourceCalls += 1; return expected; } });
		const otherNamespace = _Authority({ async __Claim() { return { ..._Claim(), attempt: { ..._Claim().attempt, namespace: "silo-b" } }; } });
		const unknownProfile = _Authority({ async __Claim() { return { ..._Claim(), attempt: { ..._Claim().attempt, workloadProfile: "unknown" } }; } });

		await expect(__ReconcileNextAgentRuntimeAttempt(_Options(otherNamespace, kubernetes), new AbortController().signal)).rejects.toThrow(/outside this controller silo/);
		await expect(__ReconcileNextAgentRuntimeAttempt(_Options(unknownProfile, kubernetes), new AbortController().signal)).rejects.toThrow(/no configured runtime profile/);
		expect(resourceCalls).toBe(0);
	});

	it("never commits when Job creation fails or its API-issued UID is missing", async function _StopsBeforeCommit()
	{
		let commits = 0;
		const authority = _Authority({ async __Claim() { return _Claim(); }, async __CommitAssignment() { commits += 1; throw new Error("unexpected commit"); } });
		const jobFailure = _Kubernetes({ async __EnsureSuspendedJob() { throw new Error("Job denied"); } });
		const missingUid = _Kubernetes({ async __EnsureSuspendedJob(expected) { return expected; } });

		await expect(__ReconcileNextAgentRuntimeAttempt(_Options(authority, jobFailure), new AbortController().signal)).rejects.toThrow(/Job denied/);
		await expect(__ReconcileNextAgentRuntimeAttempt(_Options(authority, missingUid), new AbortController().signal)).rejects.toThrow(/immutable UID/);
		expect(commits).toBe(0);
	});

	it("releases the exact assigned Job before registering its unique first Pod", async function _ReleasesAndRegisters()
	{
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-07-20T00:20:00.000Z"));
		const calls: string[] = [];
		let reconcileTraceFields: Record<string, unknown> | undefined;
		let registered: AgentControllerRunWorkloadRegistrationCommand | null = null;
		const authority = _Authority({
			async __ClaimWorkloadRelease() { calls.push("claim-release"); reconcileTraceFields = ___GetContext()?.extra; return _ReleaseClaim(); },
			async __RegisterFirstPod(_eventId, command) { calls.push("register-pod"); registered = command; return { outcome: "registered", runId: command.runId, attempt: command.attempt, workloadUid: command.workloadUid, podUid: command.podUid }; },
		});
		const kubernetes = _Kubernetes({
			async __EnsureRuntimeJobReleased(expected, workloadUid, assignmentExpiresAt, releaseLeaseExpiresAt) { calls.push("release-job"); expect([workloadUid, assignmentExpiresAt, releaseLeaseExpiresAt]).toEqual(["job-uid-1", "2026-07-20T00:25:00.000Z", "2026-07-20T00:03:00.000Z"]); return { ...expected, metadata: { ...expected.metadata, uid: workloadUid }, spec: { ...expected.spec!, suspend: false, activeDeadlineSeconds: 299 } }; },
			async __FindFirstRuntimePod(_expected, workloadUid, serviceAccountName): Promise<V1Pod | null> { calls.push("find-pod"); expect([workloadUid, serviceAccountName]).toEqual(["job-uid-1", "agent-runtime-default"]); return { metadata: { uid: "pod-uid-1" } }; },
		});

		const result = await __ReconcileNextRuntimeRelease(_Options(authority, kubernetes), new AbortController().signal);

		expect(calls).toEqual(["claim-release", "release-job", "find-pod", "register-pod"]);
		expect(registered).toMatchObject({ claimedAt: _ReleaseClaim().lease.claimedAt, deliveryCount: 1, runId: "run-1", attempt: 3, workloadUid: "job-uid-1", podUid: "pod-uid-1", bootstrapReference: "bootstrap-ref-1" });
		expect(result).toEqual({ outcome: "registered", eventId: "release-1", runId: "run-1", attempt: 3, workloadUid: "job-uid-1", podUid: "pod-uid-1" });
		expect(reconcileTraceFields).toMatchObject({ operation: "agent_controller.workload_release.reconcile", namespace: "silo-a-runtime" });
		expect(JSON.stringify(reconcileTraceFields)).not.toContain("bootstrap");
	});

	it("leaves a released Job pending when Kubernetes has not created its first Pod", async function _WaitsForPod()
	{
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-07-20T00:20:00.000Z"));
		let registrations = 0;
		const authority = _Authority({ async __ClaimWorkloadRelease() { return _ReleaseClaim(); }, async __RegisterFirstPod() { registrations += 1; throw new Error("unexpected registration"); } });
		const kubernetes = _Kubernetes({ async __EnsureRuntimeJobReleased(expected) { return { ...expected, spec: { ...expected.spec!, suspend: false } }; }, async __FindFirstRuntimePod() { return null; } });

		expect(await __ReconcileNextRuntimeRelease(_Options(authority, kubernetes), new AbortController().signal)).toEqual({ outcome: "pending-pod", eventId: "release-1", runId: "run-1", attempt: 3, workloadUid: "job-uid-1" });
		expect(registrations).toBe(0);
	});

	it("fails before Kubernetes release when the absolute assignment expiry is no longer safe", async function _RejectsExpiredRelease()
	{
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-07-20T00:25:00.000Z"));
		let kubernetesCalls = 0;
		const authority = _Authority({ async __ClaimWorkloadRelease() { return _ReleaseClaim(); } });
		const kubernetes = _Kubernetes({ async __EnsureRuntimeJobReleased(expected) { kubernetesCalls += 1; return expected; } });

		await expect(__ReconcileNextRuntimeRelease(_Options(authority, kubernetes), new AbortController().signal)).rejects.toThrow(/expires before a safe Job release/);
		expect(kubernetesCalls).toBe(0);
	});

	it("fails before Kubernetes release when durable coordinates drift from the profile", async function _RejectsReleaseDrift()
	{
		let kubernetesCalls = 0;
		const authority = _Authority({ async __ClaimWorkloadRelease() { return { ..._ReleaseClaim(), workload: { ..._ReleaseClaim().workload, serviceAccountName: "agent-runtime-foreign" } }; } });
		const kubernetes = _Kubernetes({ async __EnsureRuntimeJobReleased(expected) { kubernetesCalls += 1; return expected; } });

		await expect(__ReconcileNextRuntimeRelease(_Options(authority, kubernetes), new AbortController().signal)).rejects.toThrow(/bounded workload profile/);
		expect(kubernetesCalls).toBe(0);
	});

	it("releases the shutdown listener after every completed poll delay", async function _ReleasesWaitListener()
	{
		vi.useFakeTimers();
		const shutdown = new AbortController();
		const removeListener = vi.spyOn(shutdown.signal, "removeEventListener");
		let claims = 0;
		const authority = _Authority({
			async __Claim()
			{
				claims += 1;
				if (claims === 2) shutdown.abort();
				return null;
			},
		});
		const kubernetes = _Kubernetes({});

		const running = __RunAgentController(_Options(authority, kubernetes), shutdown.signal);
		await vi.advanceTimersByTimeAsync(1_000);
		await running;

		expect(removeListener).toHaveBeenCalledTimes(1);
	});

	it("prunes at startup, retries after a maintenance failure, and stops without arming another delay", async function _PrunesDeliveredOutboxReliably()
	{
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-07-22T10:00:00.000Z"));
		const shutdown = new AbortController();
		const error = vi.fn();
		let pruneAttempts = 0;
		const authority = _Authority({
			async __PrunePublishedOutbox()
			{
				pruneAttempts += 1;
				if (pruneAttempts === 1) throw new Error("maintenance authority unavailable");
				shutdown.abort();
				return 2;
			},
		});
		const options = { ..._Options(authority, _Kubernetes({})), outboxPruneIntervalMilliseconds: 60_000, log: { info: vi.fn(), error } as unknown as Logger };

		const running = __RunAgentController(options, shutdown.signal);
		await vi.advanceTimersByTimeAsync(60_000);
		await running;

		expect(pruneAttempts).toBe(2);
		expect(error).toHaveBeenCalledWith(expect.objectContaining({ err: expect.any(Error) }), "agent controller outbox retention failed");
	});

	it("rejects a deployment profile with a non-Kubernetes image pull policy", function _RejectsInvalidPullPolicy()
	{
		const profile = { ..._Profiles()["personal-default"], imagePullPolicy: "Sometimes" };
		expect(function _InvalidProfile() { __ValidateAgentControllerRuntimeProfiles({ "personal-default": profile }, "silo-a-runtime"); }).toThrow(/image pull policy/);
	});

	it("rejects a profile that collapses the runtime namespace into the server namespace", function _RejectsSameNamespace()
	{
		expect(function _SameNamespace() { __ValidateAgentControllerRuntimeProfiles(_Profiles(), "silo-a"); }).toThrow(/namespaces separate/);
	});
});
