import { describe, expect, it, vi } from "vitest";

import { AgentRunTaskTerminalStates, type AgentRunWarmRuntimeControllerAuthority } from "@opencrane/backend/agents/execution/runs/workflows/contract";
import type { WarmRuntimeKubernetesStore, WarmRuntimePoolProfiles } from "@opencrane/backend/agents/runtime/controller";

import { __CreateWarmAgentRunWorkflowHandler } from "../warm-agent-run-workflow-handler";

/** Returns one fixed pool profile. */
function _Profiles(): WarmRuntimePoolProfiles
{
	return { "personal-default": { namespace: "silo-a-runtime", deploymentName: "opencrane-personal-warm", serviceAccountName: "warm-runtime", genericProfile: "generic", claimedProfile: "personal", image: `ghcr.io/elewa/runtime@sha256:${"a".repeat(64)}`, imagePullPolicy: "IfNotPresent", bindingPort: 8090, genericIdleSeconds: 900, scratchSize: "64Mi", resources: { requests: { cpu: "25m", memory: "64Mi" }, limits: { cpu: "250m", memory: "128Mi" } } } };
}

/** Returns receipt-fenced warm persistence with successful default outcomes. */
function _Authority(calls: string[]): AgentRunWarmRuntimeControllerAuthority
{
	return {
		async loadForTask() { return { siloId: "silo-a", runId: "run-1", attempt: 1, agentServiceId: "service-1", agentRevisionId: "revision-1", workloadProfile: "personal-default", namespace: "silo-a-runtime", bootstrapReference: "bootstrap-v2_test", bindingGeneration: 1, assignmentExpiresAt: "2099-01-01T00:00:00.000Z", observation: "running" }; },
		async reserveWarmPod() { calls.push("reserve"); return "bound"; },
		async recordWarmProfileActivation() { calls.push("activation-recorded"); return "bound"; },
		async recordWarmReadiness() { calls.push("readiness-recorded"); return "bound"; },
		async requestWarmPodDeletion() { calls.push("delete-requested"); return "bound"; },
		async recordWarmPodDeleted() { calls.push("deleted-recorded"); return "bound"; },
		async prepareWarmRuntimeReplacement() { calls.push("replacement"); return "replace"; },
		async finalizeCancellationWithoutWarmReservation() { calls.push("unreserved-cancellation"); return "bound"; },
		async terminalizeFailedTask() { calls.push("terminalized"); },
		async observe() { return "completed"; },
	};
}

/** Returns the exact Kubernetes operations used by one warm claim. */
function _Kubernetes(calls: string[]): WarmRuntimeKubernetesStore
{
	return {
		async listGenericPods() { calls.push("list"); return [{ podName: "warm-abc", podUid: "pod-uid", resourceVersion: "12", deploymentUid: "deployment-uid", podIp: "10.42.0.10" }]; },
		async activateProfile() { calls.push("activate"); return { podUid: "pod-uid", resourceVersion: "13", profile: "personal" }; },
		async proveReadiness() { calls.push("probe"); return { podUid: "pod-uid", resourceVersion: "13", profile: "personal", observedAt: "2026-08-27T12:00:00.000Z" }; },
		async observeClaimedPod() { calls.push("observe-pod"); return "running"; },
		deletePod: vi.fn(async function _DeletePod() { calls.push("delete"); }),
	};
}

describe("warm AgentRun workflow handler", function _WarmAgentRunHandler()
{
	it("reserves, activates, proves, observes, and deletes one Pod", async function _RunsOneUseLifecycle()
	{
		const calls: string[] = [];
		const handler = __CreateWarmAgentRunWorkflowHandler({ authority: _Authority(calls), kubernetes: _Kubernetes(calls), profiles: _Profiles(), pollIntervalMilliseconds: 100 });
		const checkpoint = vi.fn(async function _Checkpoint(_options: unknown, operation: () => Promise<unknown>) { return await operation(); });
		const result = await handler.run({ checkpoint, sleepUntil: vi.fn(), task: { taskId: "task-1", taskName: "agent-runs.execute/v1", idempotencyKey: "agent-run:silo-a:run-1:attempt:1" } } as never, { siloId: "silo-a", runId: "run-1", attempt: 1 });
		expect(result.terminalState).toBe(AgentRunTaskTerminalStates.Completed);
		expect(calls).toEqual(["list", "reserve", "activate", "activation-recorded", "probe", "readiness-recorded", "delete-requested", "delete", "deleted-recorded"]);
		expect(checkpoint).toHaveBeenCalledTimes(4);
	});

	it("deletes the reserved Pod when cancellation wins after readiness", async function _CancelsRunningWarmPod()
	{
		const calls: string[] = [];
		const authority = _Authority(calls);
		authority.observe = vi.fn(async function _Cancelling() { return "cancelling" as const; });
		const sleepUntil = vi.fn();
		const handler = __CreateWarmAgentRunWorkflowHandler({ authority, kubernetes: _Kubernetes(calls), profiles: _Profiles(), pollIntervalMilliseconds: 100 });

		const result = await handler.run({ checkpoint: async function _Checkpoint(_options: unknown, operation: () => Promise<unknown>) { return await operation(); }, sleepUntil, task: { taskId: "task-1", taskName: "agent-runs.execute/v1", idempotencyKey: "agent-run:silo-a:run-1:attempt:1" } } as never, { siloId: "silo-a", runId: "run-1", attempt: 1 });

		expect(result.terminalState).toBe(AgentRunTaskTerminalStates.Cancelled);
		expect(calls).toEqual(["list", "reserve", "activate", "activation-recorded", "probe", "readiness-recorded", "delete-requested", "delete", "deleted-recorded"]);
		expect(sleepUntil).not.toHaveBeenCalled();
	});

	it("deletes a reserved Pod after readiness fails", async function _DeletesAfterFailure()
	{
		const calls: string[] = [];
		const kubernetes = _Kubernetes(calls);
		kubernetes.proveReadiness = vi.fn(async function _FailProbe() { throw new Error("not ready"); });
		const handler = __CreateWarmAgentRunWorkflowHandler({ authority: _Authority(calls), kubernetes, profiles: _Profiles(), pollIntervalMilliseconds: 100 });
		await expect(handler.run({ checkpoint: async function _Checkpoint(_options: unknown, operation: () => Promise<unknown>) { return await operation(); }, sleepUntil: vi.fn(), task: { taskId: "task-1", taskName: "agent-runs.execute/v1", idempotencyKey: "agent-run:silo-a:run-1:attempt:1" } } as never, { siloId: "silo-a", runId: "run-1", attempt: 1 })).rejects.toThrow(/temporarily unavailable/);
		expect(calls).toContain("delete");
		expect(calls).not.toContain("terminalized");
		expect(kubernetes.deletePod).toHaveBeenCalledWith(expect.objectContaining({ profile: "personal" }), expect.anything());
	});

	it("replaces a missing Pod only while the run is waiting for input", async function _ReplacesWaitingRuntime()
	{
		const calls: string[] = [];
		const authority = _Authority(calls);
		const initial = await authority.loadForTask({} as never, {} as never);
		let loads = 0;
		authority.loadForTask = vi.fn(async function _Load()
		{
			loads += 1;
			return loads === 1 ? { ...initial!, observation: "waiting_for_input" as const } : { ...initial!, bindingGeneration: 2, observation: "completed" as const };
		});
		authority.observe = vi.fn(async function _Waiting() { return "waiting_for_input" as const; });
		const kubernetes = _Kubernetes(calls);
		kubernetes.observeClaimedPod = vi.fn(async function _Missing() { return "missing" as const; });
		const handler = __CreateWarmAgentRunWorkflowHandler({ authority, kubernetes, profiles: _Profiles(), pollIntervalMilliseconds: 100 });

		const result = await handler.run({ checkpoint: async function _Checkpoint(_options: unknown, operation: () => Promise<unknown>) { return await operation(); }, sleepUntil: vi.fn(), task: { taskId: "task-1", taskName: "agent-runs.execute/v1", idempotencyKey: "agent-run:silo-a:run-1:attempt:1" } } as never, { siloId: "silo-a", runId: "run-1", attempt: 1 });

		expect(result.terminalState).toBe(AgentRunTaskTerminalStates.Completed);
		expect(calls).toContain("replacement");
		expect(calls).toContain("delete");
	});

	it("finishes an older saved deletion before reserving the replacement generation", async function _DrainsPriorDeletion()
	{
		const calls: string[] = [];
		const authority = _Authority(calls);
		const initial = await authority.loadForTask({} as never, {} as never);
		let loads = 0;
		authority.loadForTask = vi.fn(async function _Load()
		{
			loads += 1;
			return loads === 1
				? { ...initial!, bindingGeneration: 2, pendingDeletion: { generation: 1, podName: "warm-old", podUid: "pod-old", deploymentUid: "deployment-uid", profile: "personal" } }
				: { ...initial!, bindingGeneration: 2, observation: "completed" as const };
		});
		const kubernetes = _Kubernetes(calls);
		const handler = __CreateWarmAgentRunWorkflowHandler({ authority, kubernetes, profiles: _Profiles(), pollIntervalMilliseconds: 100 });

		const result = await handler.run({ checkpoint: async function _Checkpoint(_options: unknown, operation: () => Promise<unknown>) { return await operation(); }, sleepUntil: vi.fn(), task: { taskId: "task-1", taskName: "agent-runs.execute/v1", idempotencyKey: "agent-run:silo-a:run-1:attempt:1" } } as never, { siloId: "silo-a", runId: "run-1", attempt: 1 });

		expect(result.terminalState).toBe(AgentRunTaskTerminalStates.Completed);
		expect(kubernetes.deletePod).toHaveBeenCalledWith(expect.objectContaining({ podName: "warm-old", podUid: "pod-old" }), expect.anything());
		expect(calls).toEqual(["delete", "deleted-recorded"]);
	});

	it("does not replay a missing Pod while the model loop is running", async function _RequiresRecoveryForRunningRuntime()
	{
		const calls: string[] = [];
		const authority = _Authority(calls);
		const initial = await authority.loadForTask({} as never, {} as never);
		let loads = 0;
		authority.loadForTask = vi.fn(async function _Load()
		{
			loads += 1;
			return loads === 1 ? initial : { ...initial!, observation: "completed" as const };
		});
		authority.observe = vi.fn(async function _Running() { return "running" as const; });
		authority.prepareWarmRuntimeReplacement = vi.fn(async function _RecoveryRequired() { calls.push("recovery-required"); return "recovery_required" as const; });
		const kubernetes = _Kubernetes(calls);
		kubernetes.observeClaimedPod = vi.fn(async function _Terminal() { return "terminal" as const; });
		const handler = __CreateWarmAgentRunWorkflowHandler({ authority, kubernetes, profiles: _Profiles(), pollIntervalMilliseconds: 100 });

		const result = await handler.run({ checkpoint: async function _Checkpoint(_options: unknown, operation: () => Promise<unknown>) { return await operation(); }, sleepUntil: vi.fn(), task: { taskId: "task-1", taskName: "agent-runs.execute/v1", idempotencyKey: "agent-run:silo-a:run-1:attempt:1" } } as never, { siloId: "silo-a", runId: "run-1", attempt: 1 });

		expect(result.terminalState).toBe(AgentRunTaskTerminalStates.Completed);
		expect(calls).toContain("recovery-required");
		expect(calls).not.toContain("replacement");
	});

	it("waits after Pod deletion until provider output no longer defers cancellation", async function _WaitsForOutputLease()
	{
		const calls: string[] = [];
		const authority = _Authority(calls);
		let records = 0;
		authority.recordWarmPodDeleted = vi.fn(async function _Record()
		{
			records += 1;
			return records === 1 ? "deferred" : "bound";
		});
		const sleepUntil = vi.fn();
		const handler = __CreateWarmAgentRunWorkflowHandler({ authority, kubernetes: _Kubernetes(calls), profiles: _Profiles(), pollIntervalMilliseconds: 100 });

		await handler.run({ checkpoint: async function _Checkpoint(_options: unknown, operation: () => Promise<unknown>) { return await operation(); }, sleepUntil, task: { taskId: "task-1", taskName: "agent-runs.execute/v1", idempotencyKey: "agent-run:silo-a:run-1:attempt:1" } } as never, { siloId: "silo-a", runId: "run-1", attempt: 1 });

		expect(authority.recordWarmPodDeleted).toHaveBeenCalledTimes(2);
		expect(sleepUntil).toHaveBeenCalledTimes(1);
	});

	it("finalizes cancellation before reservation without touching Kubernetes", async function _CancelsBeforeReservation()
	{
		const calls: string[] = [];
		const authority = _Authority(calls);
		authority.loadForTask = vi.fn(async function _Load() { return { siloId: "silo-a", runId: "run-1", attempt: 1, agentServiceId: "service-1", agentRevisionId: "revision-1", workloadProfile: "personal-default", namespace: "silo-a-runtime", bootstrapReference: "bootstrap-v2_test", bindingGeneration: 1, assignmentExpiresAt: "2099-01-01T00:00:00.000Z", observation: "cancelling" as const }; });
		const kubernetes = _Kubernetes(calls);
		const handler = __CreateWarmAgentRunWorkflowHandler({ authority, kubernetes, profiles: _Profiles(), pollIntervalMilliseconds: 100 });

		const result = await handler.run({ checkpoint: vi.fn(), sleepUntil: vi.fn(), task: { taskId: "task-1", taskName: "agent-runs.execute/v1", idempotencyKey: "agent-run:silo-a:run-1:attempt:1" } } as never, { siloId: "silo-a", runId: "run-1", attempt: 1 });

		expect(result.terminalState).toBe(AgentRunTaskTerminalStates.Cancelled);
		expect(calls).toEqual(["unreserved-cancellation"]);
		expect(kubernetes.deletePod).not.toHaveBeenCalled();
	});

	it("re-observes a reservation conflict and stops when cancellation wins", async function _CancelsReservationConflict()
	{
		const calls: string[] = [];
		const authority = _Authority(calls);
		authority.reserveWarmPod = vi.fn(async function _Conflict() { calls.push("reserve"); return "conflict" as const; });
		authority.observe = vi.fn(async function _Cancelling() { return "cancelling" as const; });
		const kubernetes = _Kubernetes(calls);
		const handler = __CreateWarmAgentRunWorkflowHandler({ authority, kubernetes, profiles: _Profiles(), pollIntervalMilliseconds: 100 });
		const checkpoint = vi.fn(async function _Checkpoint(_options: unknown, operation: () => Promise<unknown>) { return await operation(); });

		const result = await handler.run({ checkpoint, sleepUntil: vi.fn(), task: { taskId: "task-1", taskName: "agent-runs.execute/v1", idempotencyKey: "agent-run:silo-a:run-1:attempt:1" } } as never, { siloId: "silo-a", runId: "run-1", attempt: 1 });

		expect(result.terminalState).toBe(AgentRunTaskTerminalStates.Cancelled);
		expect(calls).toEqual(["list", "reserve", "unreserved-cancellation"]);
		expect(kubernetes.deletePod).not.toHaveBeenCalled();
	});

	it("keeps cancellation open until it reacquires the saved reservation", async function _ReacquiresSavedReservation()
	{
		const calls: string[] = [];
		const authority = _Authority(calls);
		authority.observe = vi.fn(async function _Cancelling() { return "cancelling" as const; });
		let finalizationAttempts = 0;
		authority.finalizeCancellationWithoutWarmReservation = vi.fn(async function _NotYetUnreserved()
		{
			calls.push("unreserved-cancellation");
			finalizationAttempts += 1;
			return finalizationAttempts === 1 ? "deferred" : "reservation_exists";
		});
		authority.reserveWarmPod = vi.fn(async function _Reacquire() { calls.push("reserve"); return "idempotent" as const; });
		const kubernetes = _Kubernetes(calls);
		let candidateScans = 0;
		kubernetes.listGenericPods = vi.fn(async function _FindCandidate()
		{
			calls.push("list");
			candidateScans += 1;
			if (candidateScans <= 2)
				return [];
			return [{ podName: "warm-abc", podUid: "pod-uid", resourceVersion: "12", deploymentUid: "deployment-uid", podIp: "10.42.0.10" }];
		});
		const sleepUntil = vi.fn();
		const handler = __CreateWarmAgentRunWorkflowHandler({ authority, kubernetes, profiles: _Profiles(), pollIntervalMilliseconds: 100 });

		const result = await handler.run({ checkpoint: async function _Checkpoint(_options: unknown, operation: () => Promise<unknown>) { return await operation(); }, sleepUntil, task: { taskId: "task-1", taskName: "agent-runs.execute/v1", idempotencyKey: "agent-run:silo-a:run-1:attempt:1" } } as never, { siloId: "silo-a", runId: "run-1", attempt: 1 });

		expect(result.terminalState).toBe(AgentRunTaskTerminalStates.Cancelled);
		expect(calls).toEqual(["list", "unreserved-cancellation", "list", "unreserved-cancellation", "list", "reserve", "activate", "activation-recorded", "probe", "readiness-recorded", "delete-requested", "delete", "deleted-recorded"]);
		expect(sleepUntil).toHaveBeenCalledTimes(2);
		expect(kubernetes.deletePod).toHaveBeenCalledOnce();
	});
});
