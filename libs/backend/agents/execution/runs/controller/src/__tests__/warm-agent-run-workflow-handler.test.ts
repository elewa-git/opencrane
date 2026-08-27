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
		async loadForTask() { return { siloId: "silo-a", runId: "run-1", attempt: 1, agentServiceId: "service-1", agentRevisionId: "revision-1", workloadProfile: "personal-default", namespace: "silo-a-runtime", bootstrapReference: "bootstrap-v1_test", assignmentExpiresAt: "2099-01-01T00:00:00.000Z" }; },
		async reserveWarmPod() { calls.push("reserve"); return "bound"; },
		async recordWarmProfileActivation() { calls.push("activation-recorded"); return "bound"; },
		async recordWarmReadiness() { calls.push("readiness-recorded"); return "bound"; },
		async requestWarmPodDeletion() { calls.push("delete-requested"); return "bound"; },
		async recordWarmPodDeleted() { calls.push("deleted-recorded"); return "bound"; },
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
});
