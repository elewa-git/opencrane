import { describe, expect, it, vi } from "vitest";

import { AgentSandboxClaimReason, type AgentSandboxClaimCustomObjectsApi, type AgentSandboxClaimObservationCommand } from "../agent-sandbox-claims.types";
import { _KubernetesAgentSandboxClaimObservationReader } from "../kubernetes-agent-sandbox-claim-observation-reader";

function _Command(overrides: Partial<AgentSandboxClaimObservationCommand> = {}): AgentSandboxClaimObservationCommand
{
	return {
		namespace: "testv5",
		siloId: "testv5",
		computerId: "computer-41",
		generation: 2,
		profile: "developer",
		warmPoolName: "developer-pool",
		reason: AgentSandboxClaimReason.ActivationRequested,
		shutdownTime: new Date("2026-09-01T00:20:00.000Z"),
		...overrides,
	};
}

function _Claim(command: AgentSandboxClaimObservationCommand, overrides: Record<string, unknown> = {}): Record<string, unknown>
{
	return {
		apiVersion: "extensions.agents.x-k8s.io/v1beta1",
		kind: "SandboxClaim",
		metadata: {
			name: "computer-41-g2",
			namespace: command.namespace,
			generation: 1,
			labels: {
				"opencrane.ai/silo-id": command.siloId,
				"opencrane.ai/computer-id": command.computerId,
				"opencrane.ai/computer-generation": String(command.generation),
				"opencrane.ai/profile": command.profile,
			},
			annotations: { "opencrane.ai/lease-reason": command.reason },
		},
		spec: { warmPoolRef: { name: command.warmPoolName }, lifecycle: { shutdownPolicy: "DeleteForeground", shutdownTime: command.shutdownTime.toISOString() } },
		status: { sandbox: { name: "sandbox-41" }, conditions: [{ type: "Ready", status: "True", observedGeneration: 1 }] },
		...overrides,
	};
}

function _Api(result: unknown): { readonly api: AgentSandboxClaimCustomObjectsApi; readonly get: ReturnType<typeof vi.fn> }
{
	const get = vi.fn().mockResolvedValue(result);
	return { api: { createNamespacedCustomObject: vi.fn(), getNamespacedCustomObject: get }, get };
}

describe("_KubernetesAgentSandboxClaimObservationReader", function _ObservationReaderSuite()
{
	it("reads only the deterministic claim and accepts its current Ready assignment", async function _ReadsReadyClaim()
	{
		const command = _Command();
		const fixture = _Api(_Claim(command));

		await expect(new _KubernetesAgentSandboxClaimObservationReader(fixture.api).observe(command)).resolves.toEqual({ state: "ready", sandboxId: "sandbox-41" });
		expect(fixture.get).toHaveBeenCalledWith({ group: "extensions.agents.x-k8s.io", version: "v1beta1", namespace: "testv5", plural: "sandboxclaims", name: "computer-41-g2" });
	});

	it("keeps a missing, unready, or stale status pending without broad Kubernetes access", async function _KeepsPending()
	{
		const command = _Command();
		const missing = _Api(null);
		missing.get.mockRejectedValue(Object.assign(new Error("missing"), { statusCode: 404 }));
		await expect(new _KubernetesAgentSandboxClaimObservationReader(missing.api).observe(command)).resolves.toEqual({ state: "pending" });
		await expect(new _KubernetesAgentSandboxClaimObservationReader(_Api(_Claim(command, { status: { sandbox: { name: "sandbox-41" }, conditions: [{ type: "Ready", status: "False", observedGeneration: 1 }] } })).api).observe(command)).resolves.toEqual({ state: "pending" });
		await expect(new _KubernetesAgentSandboxClaimObservationReader(_Api(_Claim(command, { status: { sandbox: { name: "sandbox-41" }, conditions: [{ type: "Ready", status: "True", observedGeneration: 0 }] } })).api).observe(command)).resolves.toEqual({ state: "pending" });
	});

	it("rejects a resource whose immutable lease differs before trusting status", async function _RejectsForeignClaim()
	{
		const command = _Command();
		const foreign = _Claim(command);
		(foreign.metadata as Record<string, unknown>).labels = { ...(foreign.metadata as Record<string, Record<string, string>>).labels, "opencrane.ai/profile": "foreign" };

		await expect(new _KubernetesAgentSandboxClaimObservationReader(_Api(foreign).api).observe(command)).rejects.toThrow("conflicts with the expected immutable lease");
	});
});
