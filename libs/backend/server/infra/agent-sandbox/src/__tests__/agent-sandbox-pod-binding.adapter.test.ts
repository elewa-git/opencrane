import { describe, expect, it, vi } from "vitest";

import { AgentSandboxPodBindingAdapter } from "../agent-sandbox-pod-binding.adapter";

describe("AgentSandboxPodBindingAdapter", function _Suite()
{
	it("requires the reviewed Pod UID, ServiceAccount, sandbox name and copied lease labels", async function _ExactBinding()
	{
		const labels = { "opencrane.ai/computer-id": "computer-one", "opencrane.ai/computer-generation": "2", "opencrane.ai/computer-lease-id": "lease-one" };
		const customApi = { getNamespacedCustomObject: vi.fn().mockResolvedValue({ metadata: { labels }, status: { sandbox: { name: "sandbox-one" } } }) };
		const coreApi = { listNamespacedPod: vi.fn().mockResolvedValue({ items: [{ metadata: { name: "sandbox-one", uid: "pod-uid-1", labels }, spec: { serviceAccountName: "conversation-computer" } }] }) };
		const adapter = new AgentSandboxPodBindingAdapter(coreApi as never, customApi as never);
		const command = { computerId: "computer-one", generation: 2, leaseId: "lease-one", sandboxClaimId: "computer-one-g2", workload: { subject: "system:serviceaccount:testv5:conversation-computer", namespace: "testv5", serviceAccountName: "conversation-computer", podUid: "pod-uid-1" } };

		await expect(adapter.verify(command)).resolves.toBe(true);
		await expect(adapter.verify({ ...command, workload: { ...command.workload, podUid: "foreign-pod" } })).resolves.toBe(false);
	});
});
