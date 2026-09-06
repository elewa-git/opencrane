import { describe, expect, it, vi } from "vitest";

import { AgentSandboxClaimAdapter } from "../agent-sandbox-claim.adapter";
import type { AgentSandboxClaimCommand } from "../agent-sandbox-claim.types";

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

		expect(result).toEqual({ claimId: "computer-1-g2", outcome: "created", sandboxId: null, serviceFQDN: null });
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
			status: { sandbox: { name: "sandbox-2", serviceFQDN: "sandbox-2.silo-1-computers.svc.cluster.local" } },
		});
		const result = await new AgentSandboxClaimAdapter({ getNamespacedCustomObject, createNamespacedCustomObject: vi.fn() } as never).claim(command);
		expect(result).toEqual({ claimId: "computer-1-g2", outcome: "existing", sandboxId: "sandbox-2", serviceFQDN: "sandbox-2.silo-1-computers.svc.cluster.local" });
	});

	it("fails closed when the deterministic name contains another claim", async function _RejectConflict()
	{
		const getNamespacedCustomObject = vi.fn().mockResolvedValue({ metadata: { name: "computer-1-g2", namespace: "silo-1-computers", labels: {}, annotations: {} }, spec: {} });
		await expect(new AgentSandboxClaimAdapter({ getNamespacedCustomObject, createNamespacedCustomObject: vi.fn() } as never).claim(_Command())).rejects.toThrow(/conflicts/);
	});

	it("releases only the deterministic claim whose labels still match the lease", async function _ReleaseClaim()
	{
		const getNamespacedCustomObject = vi.fn().mockResolvedValue({ metadata: { name: "computer-1-g2", namespace: "silo-1-computers", labels: { "opencrane.ai/computer-id": "computer-1", "opencrane.ai/computer-generation": "2", "opencrane.ai/computer-lease-id": "lease-2" } } });
		const deleteNamespacedCustomObject = vi.fn().mockResolvedValue({});
		const adapter = new AgentSandboxClaimAdapter({ getNamespacedCustomObject, createNamespacedCustomObject: vi.fn(), deleteNamespacedCustomObject } as never);

		await expect(adapter.release({ namespace: "silo-1-computers", claimId: "computer-1-g2", computerId: "computer-1", leaseId: "lease-2", generation: 2 })).resolves.toBe("released");
		expect(deleteNamespacedCustomObject).toHaveBeenCalledWith(expect.objectContaining({ name: "computer-1-g2", body: { propagationPolicy: "Foreground" } }));
	});

	it("refuses to release a claim after its lease labels diverge", async function _RejectRelease()
	{
		const getNamespacedCustomObject = vi.fn().mockResolvedValue({ metadata: { name: "computer-1-g2", namespace: "silo-1-computers", labels: { "opencrane.ai/computer-id": "computer-1", "opencrane.ai/computer-generation": "2", "opencrane.ai/computer-lease-id": "foreign-lease" } } });
		const deleteNamespacedCustomObject = vi.fn();
		const adapter = new AgentSandboxClaimAdapter({ getNamespacedCustomObject, createNamespacedCustomObject: vi.fn(), deleteNamespacedCustomObject } as never);

		await expect(adapter.release({ namespace: "silo-1-computers", claimId: "computer-1-g2", computerId: "computer-1", leaseId: "lease-2", generation: 2 })).rejects.toThrow(/does not match/);
		expect(deleteNamespacedCustomObject).not.toHaveBeenCalled();
	});

	it("renews only a matching claim through a merge patch that moves the shutdown later", async function _RenewClaim()
	{
		const getNamespacedCustomObject = vi.fn().mockResolvedValue({ metadata: { name: "computer-1-g2", namespace: "silo-1-computers", labels: { "opencrane.ai/computer-id": "computer-1", "opencrane.ai/computer-generation": "2", "opencrane.ai/computer-lease-id": "lease-2" } }, spec: { lifecycle: { shutdownPolicy: "DeleteForeground", shutdownTime: "2026-09-05T12:00:00.000Z" } } });
		const patchNamespacedCustomObject = vi.fn().mockResolvedValue({});
		const adapter = new AgentSandboxClaimAdapter({ getNamespacedCustomObject, createNamespacedCustomObject: vi.fn(), patchNamespacedCustomObject } as never);
		const command = { namespace: "silo-1-computers", claimId: "computer-1-g2", computerId: "computer-1", leaseId: "lease-2", generation: 2 };

		await expect(adapter.renew({ ...command, expiresAt: "2026-09-05T13:00:00.000Z" })).resolves.toBe("renewed");
		expect(patchNamespacedCustomObject).toHaveBeenCalledWith(expect.objectContaining({ name: "computer-1-g2", plural: "sandboxclaims", body: { spec: { lifecycle: { shutdownTime: "2026-09-05T13:00:00.000Z" } } } }), expect.anything());
		await expect(adapter.renew({ ...command, expiresAt: "2026-09-05T11:00:00.000Z" })).rejects.toThrow(/later/);
		expect(patchNamespacedCustomObject).toHaveBeenCalledOnce();
		getNamespacedCustomObject.mockRejectedValue({ code: 404 });
		await expect(adapter.renew({ ...command, expiresAt: "2026-09-05T13:00:00.000Z" })).resolves.toBe("absent");
	});

	it("inspects the controller view of a matching claim and reports a deleted claim as null", async function _InspectClaim()
	{
		const getNamespacedCustomObject = vi.fn().mockResolvedValue({ metadata: { name: "computer-1-g2", namespace: "silo-1-computers", labels: { "opencrane.ai/computer-id": "computer-1", "opencrane.ai/computer-generation": "2", "opencrane.ai/computer-lease-id": "lease-2" } }, spec: { lifecycle: { shutdownTime: "2026-09-05T12:00:00.000Z" } }, status: { sandbox: { name: "sandbox-2", serviceFQDN: "sandbox-2.silo-1-computers.svc.cluster.local" } } });
		const adapter = new AgentSandboxClaimAdapter({ getNamespacedCustomObject, createNamespacedCustomObject: vi.fn() } as never);
		const command = { namespace: "silo-1-computers", claimId: "computer-1-g2", computerId: "computer-1", leaseId: "lease-2", generation: 2 };

		await expect(adapter.inspect(command)).resolves.toEqual({ claimId: "computer-1-g2", sandboxId: "sandbox-2", serviceFQDN: "sandbox-2.silo-1-computers.svc.cluster.local", shutdownTime: "2026-09-05T12:00:00.000Z" });
		await expect(adapter.inspect({ ...command, leaseId: "lease-9" })).rejects.toThrow(/does not match/);
		getNamespacedCustomObject.mockRejectedValue({ code: 404 });
		await expect(adapter.inspect(command)).resolves.toBeNull();
	});
});
