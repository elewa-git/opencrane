import { describe, expect, it, vi } from "vitest";

import type { AgentSandboxClaimCustomObjectsApi, AgentSandboxCoreApi, AgentSandboxRuntimePodCommand } from "../agent-sandbox-claims.types";
import { _KubernetesAgentSandboxRuntimePodReader } from "../kubernetes-agent-sandbox-runtime-pod-reader";

/** Builds the trusted controller and template coordinates for one assigned Sandbox. */
function _Command(overrides: Partial<AgentSandboxRuntimePodCommand> = {}): AgentSandboxRuntimePodCommand
{
	return { namespace: "testv5", sandboxId: "sandbox-41", serviceAccountName: "agent-sandbox-runtime", ...overrides };
}

/** Builds the v1 Sandbox resource whose name selects its backing Pod. */
function _Sandbox(command: AgentSandboxRuntimePodCommand, overrides: Record<string, unknown> = {}): Record<string, unknown>
{
	return {
		apiVersion: "agents.x-k8s.io/v1beta1",
		kind: "Sandbox",
		metadata: { name: command.sandboxId, namespace: command.namespace, uid: "sandbox-uid-41" },
		...overrides,
	};
}

/** Builds one backing Pod with the controller-owned Sandbox owner reference and exact template identity. */
function _Pod(command: AgentSandboxRuntimePodCommand, overrides: Record<string, unknown> = {}): Record<string, unknown>
{
	return {
		metadata: {
			name: command.sandboxId,
			namespace: command.namespace,
			uid: "pod-uid-41",
			ownerReferences: [{ apiVersion: "agents.x-k8s.io/v1beta1", kind: "Sandbox", name: command.sandboxId, uid: "sandbox-uid-41", controller: true }],
		},
		spec: { serviceAccountName: command.serviceAccountName },
		...overrides,
	};
}

/** Builds the narrow custom-resource and Pod-read ports with independently controlled results. */
function _Apis(sandbox: unknown, pod: unknown): { readonly customApi: AgentSandboxClaimCustomObjectsApi; readonly coreApi: AgentSandboxCoreApi; readonly getSandbox: ReturnType<typeof vi.fn>; readonly getPod: ReturnType<typeof vi.fn> }
{
	const getSandbox = vi.fn().mockResolvedValue(sandbox);
	const getPod = vi.fn().mockResolvedValue(pod);
	return { customApi: { createNamespacedCustomObject: vi.fn(), getNamespacedCustomObject: getSandbox }, coreApi: { readNamespacedPod: getPod }, getSandbox, getPod };
}

describe("_KubernetesAgentSandboxRuntimePodReader", function _RuntimePodReaderSuite()
{
	it("binds one ready Sandbox to its exact controller-owned Pod UID", async function _ReadsOwnedPod()
	{
		const command = _Command();
		const fixture = _Apis(_Sandbox(command), _Pod(command));

		await expect(new _KubernetesAgentSandboxRuntimePodReader(fixture.customApi, fixture.coreApi).read(command)).resolves.toEqual({ namespace: "testv5", serviceAccountName: "agent-sandbox-runtime", podUid: "pod-uid-41" });
		expect(fixture.getSandbox).toHaveBeenCalledWith({ group: "agents.x-k8s.io", version: "v1beta1", namespace: "testv5", plural: "sandboxes", name: "sandbox-41" });
		expect(fixture.getPod).toHaveBeenCalledWith({ namespace: "testv5", name: "sandbox-41" });
	});

	it("keeps reconciliation pending while the assigned Sandbox or backing Pod is absent", async function _KeepsPendingForMissingResource()
	{
		const command = _Command();
		const missingSandbox = _Apis(null, _Pod(command));
		missingSandbox.getSandbox.mockRejectedValue(Object.assign(new Error("missing Sandbox"), { statusCode: 404 }));
		const missingPod = _Apis(_Sandbox(command), null);
		missingPod.getPod.mockRejectedValue(Object.assign(new Error("missing Pod"), { statusCode: 404 }));

		await expect(new _KubernetesAgentSandboxRuntimePodReader(missingSandbox.customApi, missingSandbox.coreApi).read(command)).resolves.toBeNull();
		await expect(new _KubernetesAgentSandboxRuntimePodReader(missingPod.customApi, missingPod.coreApi).read(command)).resolves.toBeNull();
	});

	it("rejects a same-name Pod that lacks the assigned Sandbox controller and template identity", async function _RejectsForeignPod()
	{
		const command = _Command();
		const foreignOwner = _Pod(command, { metadata: { name: "sandbox-41", namespace: "testv5", uid: "pod-uid-41", ownerReferences: [{ apiVersion: "agents.x-k8s.io/v1beta1", kind: "Sandbox", name: "sandbox-41", uid: "sandbox-uid-replacement", controller: true }] } });
		const wrongServiceAccount = _Pod(command, { spec: { serviceAccountName: "foreign-runtime" } });
		const foreignOwnerApis = _Apis(_Sandbox(command), foreignOwner);
		const wrongServiceAccountApis = _Apis(_Sandbox(command), wrongServiceAccount);
		const foreignOwnerReader = new _KubernetesAgentSandboxRuntimePodReader(foreignOwnerApis.customApi, foreignOwnerApis.coreApi);
		const wrongServiceAccountReader = new _KubernetesAgentSandboxRuntimePodReader(wrongServiceAccountApis.customApi, wrongServiceAccountApis.coreApi);

		await expect(foreignOwnerReader.read(command)).rejects.toThrow("does not match its assigned Sandbox identity");
		await expect(wrongServiceAccountReader.read(command)).rejects.toThrow("does not match its assigned Sandbox identity");
	});
});
