import { describe, expect, it, vi } from "vitest";

import type { AgentSandboxConversationComputerRealization } from "@opencrane/contracts";

import { AgentSandboxPodBindingAdapter } from "../agent-sandbox-pod-binding.adapter";
import type { AgentSandboxPodBindingCommand } from "../agent-sandbox-pod-binding.types";

/** Supplies a claim and its named Pod without granting namespace-wide discovery. */
function _Fixture()
{
	const labels = { "opencrane.ai/computer-id": "computer-one", "opencrane.ai/computer-generation": "2", "opencrane.ai/computer-lease-id": "lease-one" };
	const claim = { metadata: { labels }, status: { sandbox: { name: "sandbox-one" } } };
	const sandbox = { metadata: { namespace: "testv5", name: "sandbox-one" }, status: { service: "sandbox-one", serviceFQDN: "sandbox-one.testv5.svc.cluster.local" } };
	const pod = { metadata: { namespace: "testv5", name: "sandbox-one", uid: "pod-uid-1", labels: { ...labels } }, spec: { serviceAccountName: "conversation-computer" } };
	const customApi = { getNamespacedCustomObject: vi.fn().mockImplementation(async function _Read(request) { return request.plural === "sandboxes" ? sandbox : claim; }) };
	const coreApi = { readNamespacedPod: vi.fn().mockResolvedValue(pod) };
	const adapter = new AgentSandboxPodBindingAdapter(coreApi as never, customApi as never);
	const command: AgentSandboxPodBindingCommand = {
		computerId: "computer-one",
		lease: { leaseId: "lease-one", leaseGeneration: 2 },
		realization: { kind: "agent_sandbox" as AgentSandboxConversationComputerRealization["kind"], claimId: "computer-one-g2", sandboxId: "sandbox-one", serviceFQDN: "sandbox-one.testv5.svc.cluster.local" },
		workload: { subject: "system:serviceaccount:testv5:conversation-computer", namespace: "testv5", serviceAccountName: "conversation-computer", podUid: "pod-uid-1" },
	};
	return { adapter, command, coreApi, customApi, claim, pod, sandbox };
}

describe("AgentSandboxPodBindingAdapter", function _Suite()
{
	it("reads only the Pod named by the admitted claim in the reviewed namespace", async function _ExactBinding()
	{
		const fixture = _Fixture();
		await expect(fixture.adapter.verify(fixture.command)).resolves.toBe(true);
		expect(fixture.coreApi.readNamespacedPod).toHaveBeenCalledExactlyOnceWith({ namespace: "testv5", name: "sandbox-one" });
	});

	it.each(["uid", "name", "namespace"] as const)("rejects a Pod with a foreign %s", async function _ForeignIdentity(field)
	{
		const fixture = _Fixture();
		fixture.pod.metadata[field] = "foreign";
		await expect(fixture.adapter.verify(fixture.command)).resolves.toBe(false);
	});

	it("rejects a Pod using another ServiceAccount", async function _ForeignServiceAccount()
	{
		const fixture = _Fixture();
		fixture.pod.spec.serviceAccountName = "foreign";
		await expect(fixture.adapter.verify(fixture.command)).resolves.toBe(false);
	});

	it.each(["opencrane.ai/computer-id", "opencrane.ai/computer-generation", "opencrane.ai/computer-lease-id"] as const)("rejects changed Pod and claim labels at %s", async function _ForeignLease(field)
	{
		const fixture = _Fixture();
		fixture.pod.metadata.labels[field] = "foreign";
		await expect(fixture.adapter.verify(fixture.command)).resolves.toBe(false);
		fixture.coreApi.readNamespacedPod.mockClear();
		fixture.claim.metadata.labels[field] = "foreign";
		await expect(fixture.adapter.verify(fixture.command)).resolves.toBe(false);
		expect(fixture.coreApi.readNamespacedPod).not.toHaveBeenCalled();
	});

	it("does not read a Pod before the claim has a Sandbox assignment", async function _PendingClaim()
	{
		const fixture = _Fixture();
		fixture.customApi.getNamespacedCustomObject.mockResolvedValue({ metadata: fixture.claim.metadata });
		await expect(fixture.adapter.verify(fixture.command)).resolves.toBe(false);
		expect(fixture.coreApi.readNamespacedPod).not.toHaveBeenCalled();
	});

	it("rejects a controller assignment that differs from the persisted realization", async function _ChangedSandbox()
	{
		const fixture = _Fixture();
		fixture.claim.status.sandbox.name = "replacement";
		await expect(fixture.adapter.verify(fixture.command)).resolves.toBe(false);
		expect(fixture.coreApi.readNamespacedPod).not.toHaveBeenCalled();
	});

	it("rejects Service coordinates that differ from the persisted realization", async function _ChangedService()
	{
		const fixture = _Fixture();
		fixture.sandbox.status.serviceFQDN = "replacement.testv5.svc.cluster.local";
		await expect(fixture.adapter.verify(fixture.command)).resolves.toBe(false);
		expect(fixture.coreApi.readNamespacedPod).not.toHaveBeenCalled();
	});

	it("rejects a Pod deleted between TokenReview and the named read", async function _MissingPod()
	{
		const fixture = _Fixture();
		fixture.coreApi.readNamespacedPod.mockRejectedValue(Object.assign(new Error("not found"), { code: 404 }));
		await expect(fixture.adapter.verify(fixture.command)).resolves.toBe(false);
	});

	it.each([403, 500])("preserves Kubernetes failure %s for the transport diagnostic", async function _InfrastructureFailure(code)
	{
		const fixture = _Fixture();
		const error = Object.assign(new Error("Kubernetes request failed"), { code });
		fixture.coreApi.readNamespacedPod.mockRejectedValue(error);
		await expect(fixture.adapter.verify(fixture.command)).rejects.toBe(error);
	});
});
