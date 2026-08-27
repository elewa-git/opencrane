import type { V1Job, V1Pod, V1Secret } from "@kubernetes/client-node";

import { AgentRunTaskTerminalStates } from "@opencrane/backend/agents/execution/runs/workflows/contract";
import { AgentRuntimeIdentityProfiles } from "@opencrane/backend/agents/runtime/k8s-launcher";
import type { AgentControllerRuntimeProfiles } from "@opencrane/backend/agents/runtime/controller";
import { describe, expect, it, vi } from "vitest";

import { __CreateAgentRunWorkflowHandler } from "../agent-run-workflow-handler";
import type { AgentRunWorkflowControllerAuthority, AgentRunWorkflowHandlerOptions, AgentRunWorkflowKubernetesStore } from "../agent-run-workflow-handler.types";

/** Returns one deployment-owned profile that satisfies the runtime Job builder. */
function _Profiles(): AgentControllerRuntimeProfiles
{
	return {
		"personal-default": {
			namespace: "silo-a-runtime",
			identityProfile: AgentRuntimeIdentityProfiles.Personal,
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

/** Returns the task-bound authority used by the handler test. */
function _Authority(overrides: Partial<AgentRunWorkflowControllerAuthority> = {}): AgentRunWorkflowControllerAuthority
{
	return {
		async loadForTask() { return { siloId: "silo-1", runId: "run-1", attempt: 1, agentServiceId: "service-1", agentRevisionId: "revision-1", workloadProfile: "personal-default", namespace: "silo-a-runtime", bootstrapReference: `bootstrap-v1_${"0".repeat(64)}`, assignmentExpiresAt: "2099-01-01T00:00:00.000Z" }; },
		async mintAttemptKey() { return { key: "sk-attempt-key", keyAlias: "attempt-handler-test" }; },
		async revokeAttemptKey() {},
		async bindAssignment() { return "bound"; },
		async bindFirstPod() { return "bound"; },
		async claimRelease() { return { expiresAt: "2099-01-01T00:00:00.000Z" }; },
		async terminalizeFailedTask() {},
		async observe() { return "completed"; },
		...overrides,
	};
}

/** Returns a Kubernetes adapter that records the Job, Secret, release, and Pod operations. */
function _Kubernetes(calls: string[], secretOutcome: "created" | "alreadyExists" = "created"): AgentRunWorkflowKubernetesStore
{
	return {
		async ensureSuspendedJob(expected: V1Job) { calls.push("job"); return { ...expected, metadata: { ...expected.metadata, uid: "job-uid-1" } }; },
		async ensureAttemptKeySecret(_expected: V1Secret) { calls.push("secret"); return secretOutcome; },
		async releaseJob(expected: V1Job) { calls.push("release"); return expected; },
		async findFirstPod(_expected: V1Job) { calls.push("pod"); return { metadata: { uid: "pod-uid-1" } } as V1Pod; },
	};
}

/** Builds one handler with fixed profiles and no waiting needed by the terminal observation. */
function _Options(calls: string[]): AgentRunWorkflowHandlerOptions
{
	return { authority: _Authority(), kubernetes: _Kubernetes(calls), profiles: _Profiles(), pollIntervalMilliseconds: 1_000 };
}

describe("AgentRun workflow handler", function _Suite()
{
	it("creates, binds, releases, and observes one runtime Job without checkpointing its model key", async function _RunsOneAttempt()
	{
		const calls: string[] = [];
		const checkpoint = vi.fn(async function _Checkpoint(_options: unknown, operation: () => Promise<unknown>) { return await operation(); });
		const handler = __CreateAgentRunWorkflowHandler(_Options(calls));
		const result = await handler.run({ checkpoint, sleepUntil: vi.fn(), task: { taskId: "task-1" } } as never, { siloId: "silo-1", runId: "run-1", attempt: 1 });
		expect(result).toEqual({ runId: "run-1", attempt: 1, terminalState: AgentRunTaskTerminalStates.Completed });
		expect(calls).toEqual(["job", "secret", "release", "pod"]);
		expect(checkpoint).toHaveBeenCalledTimes(4);
	});

	it("stops before release when the server cancellation fence refuses the Job", async function _StopsAfterCancellation()
	{
		const calls: string[] = [];
		const handler = __CreateAgentRunWorkflowHandler({ authority: _Authority({ async claimRelease() { return null; } }), kubernetes: _Kubernetes(calls), profiles: _Profiles(), pollIntervalMilliseconds: 1_000 });
		const result = await handler.run({ checkpoint: async function _Checkpoint(_options: unknown, operation: () => Promise<unknown>) { return await operation(); }, sleepUntil: vi.fn(), task: { taskId: "task-1" } } as never, { siloId: "silo-1", runId: "run-1", attempt: 1 });
		expect(result.terminalState).toBe(AgentRunTaskTerminalStates.Cancelled);
		expect(calls).toEqual(["job", "secret"]);
	});

	it("revokes the newly minted key when the exact suspended Job already owns its Secret", async function _RevokesUnusedKey()
	{
		const calls: string[] = [];
		const revokeAttemptKey = vi.fn(async function _RevokeAttemptKey() {});
		const handler = __CreateAgentRunWorkflowHandler({ authority: _Authority({ revokeAttemptKey }), kubernetes: _Kubernetes(calls, "alreadyExists"), profiles: _Profiles(), pollIntervalMilliseconds: 1_000 });

		await expect(handler.run({ checkpoint: async function _Checkpoint(_options: unknown, operation: () => Promise<unknown>) { return await operation(); }, sleepUntil: vi.fn(), task: { taskId: "task-1" } } as never, { siloId: "silo-1", runId: "run-1", attempt: 1 })).resolves.toMatchObject({ terminalState: AgentRunTaskTerminalStates.Completed });
		expect(revokeAttemptKey).toHaveBeenCalledWith({ siloId: "silo-1", runId: "run-1", attempt: 1 }, { taskId: "task-1" }, { key: "sk-attempt-key", keyAlias: "attempt-handler-test" });
		expect(calls).toEqual(["job", "secret", "release", "pod"]);
	});

	it("rechecks current authority after a restart instead of replaying a saved attempt record", async function _RechecksAfterRestart()
	{
		const calls: string[] = [];
		const terminalizeFailedTask = vi.fn(async function _TerminalizeFailedTask() {});
		const authority = _Authority({ terminalizeFailedTask });
		let active = true;
		const originalLoad = authority.loadForTask;
		authority.loadForTask = async function _LoadForTask(input, task)
		{
			return active ? await originalLoad(input, task) : null;
		};
		const handler = __CreateAgentRunWorkflowHandler({ authority, kubernetes: _Kubernetes(calls), profiles: _Profiles(), pollIntervalMilliseconds: 1_000 });
		const context = { checkpoint: async function _Checkpoint(_options: unknown, operation: () => Promise<unknown>) { return await operation(); }, sleepUntil: vi.fn(), task: { taskId: "task-1" } } as never;
		await handler.run(context, { siloId: "silo-1", runId: "run-1", attempt: 1 });
		active = false;
		const result = await handler.run(context, { siloId: "silo-1", runId: "run-1", attempt: 1 });
		expect(result.terminalState).toBe(AgentRunTaskTerminalStates.Cancelled);
		expect(terminalizeFailedTask).toHaveBeenCalledOnce();
		expect(calls).toEqual(["job", "secret", "release", "pod"]);
	});

	it("revokes the raw key before terminalising after a released Job reports a conflicting first Pod", async function _RevokesBeforeTerminalisingReleasedJob()
	{
		const calls: string[] = [];
		const terminalOrder: string[] = [];
		const handler = __CreateAgentRunWorkflowHandler({
			authority: _Authority({
				async bindFirstPod() { return "conflict"; },
				async revokeAttemptKey() { terminalOrder.push("revoke"); },
				async terminalizeFailedTask() { terminalOrder.push("terminalize"); },
			}),
			kubernetes: _Kubernetes(calls),
			profiles: _Profiles(),
			pollIntervalMilliseconds: 1_000,
		});

		await expect(handler.run({ checkpoint: async function _Checkpoint(_options: unknown, operation: () => Promise<unknown>) { return await operation(); }, sleepUntil: vi.fn(), task: { taskId: "task-1" } } as never, { siloId: "silo-1", runId: "run-1", attempt: 1 })).rejects.toThrow("first Pod no longer matches");
		expect(calls).toEqual(["job", "secret", "release", "pod"]);
		expect(terminalOrder).toEqual(["revoke", "terminalize"]);
	});

	it("revokes the raw key before returning a post-release cancellation observation", async function _RevokesBeforeCancelledObservation()
	{
		const calls: string[] = [];
		const terminalOrder: string[] = [];
		const handler = __CreateAgentRunWorkflowHandler({
			authority: _Authority({
				async observe() { return "cancelled"; },
				async revokeAttemptKey() { terminalOrder.push("revoke"); },
			}),
			kubernetes: _Kubernetes(calls),
			profiles: _Profiles(),
			pollIntervalMilliseconds: 1_000,
		});

		await expect(handler.run({ checkpoint: async function _Checkpoint(_options: unknown, operation: () => Promise<unknown>) { return await operation(); }, sleepUntil: vi.fn(), task: { taskId: "task-1" } } as never, { siloId: "silo-1", runId: "run-1", attempt: 1 })).resolves.toMatchObject({ terminalState: AgentRunTaskTerminalStates.Cancelled });
		expect(calls).toEqual(["job", "secret", "release", "pod"]);
		expect(terminalOrder).toEqual(["revoke"]);
	});
});
