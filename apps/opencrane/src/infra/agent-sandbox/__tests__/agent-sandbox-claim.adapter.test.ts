import { describe, expect, it, vi } from "vitest";

import { AgentSandboxClaimAdapter, type AgentSandboxClaimCommand } from "../agent-sandbox-claim.adapter";

function _Command(overrides: Partial<AgentSandboxClaimCommand> = {}): AgentSandboxClaimCommand
{
	return { siloId: "silo-1", computerId: "computer-1", leaseId: "lease-2", generation: 2, namespace: "silo-1-computers", profileName: "developer", warmPoolName: "developer-pool", expiresAt: "2026-09-05T12:00:00.000Z", reason: "activation_requested", ...overrides };
}

describe("AgentSandboxClaimAdapter", function _AgentSandboxClaimAdapterSuite()
{
	it("creates the release-constrained deterministic v1beta1 claim", async function _CreateClaim()
	{
		const getNamespacedCustomObject = vi.fn().mockRejectedValue({ code: 404 });
		const createNamespacedCustomObject = vi.fn().mockResolvedValue({});
		const result = await new AgentSandboxClaimAdapter({ getNamespacedCustomObject, createNamespacedCustomObject } as never).claim(_Command());

		expect(result).toEqual({ claimId: "computer-1-g2", outcome: "created", sandboxId: null });
		expect(createNamespacedCustomObject).toHaveBeenCalledWith(expect.objectContaining({
			group: "extensions.agents.x-k8s.io", version: "v1beta1", namespace: "silo-1-computers", plural: "sandboxclaims",
			body: expect.objectContaining({
				metadata: expect.objectContaining({ name: "computer-1-g2", labels: expect.objectContaining({ "opencrane.ai/computer-generation": "2", "opencrane.ai/profile": "developer" }) }),
				spec: {
					warmPoolRef: { name: "developer-pool" },
					lifecycle: { shutdownPolicy: "DeleteForeground", shutdownTime: "2026-09-05T12:00:00.000Z" },
					additionalPodMetadata: { labels: { "opencrane.ai/computer-id": "computer-1", "opencrane.ai/computer-generation": "2", "opencrane.ai/computer-lease-id": "lease-2" }, annotations: {} },
				},
			}),
		}));
	});

	it("observes an identical claim and returns its assigned sandbox", async function _ObserveClaim()
	{
		const command = _Command();
		const getNamespacedCustomObject = vi.fn().mockResolvedValue({
			metadata: { name: "computer-1-g2", namespace: command.namespace, labels: { "opencrane.ai/silo-id": command.siloId, "opencrane.ai/computer-id": command.computerId, "opencrane.ai/computer-generation": "2", "opencrane.ai/computer-lease-id": command.leaseId, "opencrane.ai/profile": command.profileName }, annotations: { "opencrane.ai/lease-reason": command.reason } },
			spec: {
				warmPoolRef: { name: command.warmPoolName },
				lifecycle: { shutdownPolicy: "DeleteForeground", shutdownTime: command.expiresAt },
				additionalPodMetadata: { labels: { "opencrane.ai/computer-id": command.computerId, "opencrane.ai/computer-generation": "2", "opencrane.ai/computer-lease-id": command.leaseId }, annotations: {} },
			},
			status: { sandbox: { name: "sandbox-2" } },
		});
		const result = await new AgentSandboxClaimAdapter({ getNamespacedCustomObject, createNamespacedCustomObject: vi.fn() } as never).claim(command);
		expect(result).toEqual({ claimId: "computer-1-g2", outcome: "existing", sandboxId: "sandbox-2" });
	});

	it("fails closed when the deterministic name contains another claim", async function _RejectConflict()
	{
		const getNamespacedCustomObject = vi.fn().mockResolvedValue({ metadata: { name: "computer-1-g2", namespace: "silo-1-computers", labels: {}, annotations: {} }, spec: {} });
		await expect(new AgentSandboxClaimAdapter({ getNamespacedCustomObject, createNamespacedCustomObject: vi.fn() } as never).claim(_Command())).rejects.toThrow(/conflicts/);
	});
});
