import { describe, expect, it, vi } from "vitest";

import { AgentSandboxClaimAdapter } from "../agent-sandbox-claim.adapter";
import type { AgentSandboxClaimCommand } from "../agent-sandbox-claim.types";

function _Command(overrides: Partial<AgentSandboxClaimCommand> = {}): AgentSandboxClaimCommand
{
	return { siloId: "silo-1", computerId: "computer-1", leaseId: "lease-2", generation: 2, namespace: "silo-1-computers", profileName: "developer", warmPoolName: "developer-pool", expiresAt: "2026-09-05T12:00:00.987Z", reason: "activation_requested", ...overrides };
}

function _LeaseCommand()
{
	return { namespace: "silo-1-computers", claimId: "computer-1-g2", computerId: "computer-1", leaseId: "lease-2", generation: 2 };
}

/**
 * Uses the v0.5.3 claim shape: assignment has a name and Pod IPs, never a Service address.
 * @see https://github.com/kubernetes-sigs/agent-sandbox/blob/v0.5.3/extensions/api/v1beta1/sandboxclaim_types.go
 */
function _Claim()
{
	const command = _Command();
	return {
		apiVersion: "extensions.agents.x-k8s.io/v1beta1", kind: "SandboxClaim",
		metadata: {
			name: "computer-1-g2", namespace: command.namespace, uid: "claim-uid", resourceVersion: "73",
			labels: { "opencrane.ai/silo-id": command.siloId, "opencrane.ai/computer-id": command.computerId, "opencrane.ai/computer-generation": "2", "opencrane.ai/computer-lease-id": command.leaseId, "opencrane.ai/profile": command.profileName },
			annotations: {
				"opencrane.ai/lease-reason": command.reason,
				"agents.x-k8s.io/controller-first-observed-at": "2026-09-05T11:00:00Z",
				"opentelemetry.io/trace-context": "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
				"agents.x-k8s.io/creation-latency-recorded": "true",
				"agents.x-k8s.io/sandbox-name": "sandbox-2",
			},
		},
		spec: {
			warmPoolRef: { name: command.warmPoolName },
			lifecycle: { shutdownPolicy: "DeleteForeground", shutdownTime: "2026-09-05T12:00:00Z" },
			additionalPodMetadata: { labels: { "opencrane.ai/computer-id": command.computerId, "opencrane.ai/computer-generation": "2", "opencrane.ai/computer-lease-id": command.leaseId } },
		},
		status: { sandbox: { name: "sandbox-2", podIPs: ["10.1.2.3"] }, conditions: [{ type: "Ready", status: "False", reason: "SandboxNotReady" }] },
	};
}

/**
 * Carries the Service fields on their real owner, independently of Pod readiness.
 * @see https://github.com/kubernetes-sigs/agent-sandbox/blob/v0.5.3/api/v1beta1/sandbox_types.go
 */
function _Sandbox()
{
	return {
		apiVersion: "agents.x-k8s.io/v1beta1", kind: "Sandbox",
		metadata: {
			name: "sandbox-2", namespace: "silo-1-computers", uid: "sandbox-uid", resourceVersion: "80",
			ownerReferences: [{ apiVersion: "extensions.agents.x-k8s.io/v1beta1", kind: "SandboxClaim", name: "computer-1-g2", uid: "claim-uid", controller: true, blockOwnerDeletion: true }],
		},
		status: { service: "sandbox-2-service", serviceFQDN: "sandbox-2-service.silo-1-computers.svc.cluster.local", conditions: [{ type: "Ready", status: "False", reason: "PodNotReady" }] },
	};
}

function _Api(claim: unknown = _Claim(), sandbox: unknown = _Sandbox())
{
	return {
		getNamespacedCustomObject: vi.fn(async function _Get(request: { readonly plural: string })
		{
			const resource = request.plural === "sandboxclaims" ? claim : sandbox;
			if (resource === null)
				throw { code: 404 };
			return resource;
		}),
		createNamespacedCustomObject: vi.fn().mockResolvedValue({}),
		patchNamespacedCustomObject: vi.fn().mockResolvedValue({}),
		deleteNamespacedCustomObject: vi.fn().mockResolvedValue({}),
	};
}

describe("AgentSandboxClaimAdapter", function _AgentSandboxClaimAdapterSuite()
{
	it("creates the release-constrained v1beta1 claim at upstream timestamp precision", async function _CreateClaim()
	{
		const api = _Api(null);
		const result = await new AgentSandboxClaimAdapter(api as never).claim(_Command());

		expect(result).toEqual({ claimId: "computer-1-g2", outcome: "created", sandboxId: null, serviceFQDN: null });
		expect(api.createNamespacedCustomObject).toHaveBeenCalledWith(expect.objectContaining({
			group: "extensions.agents.x-k8s.io", version: "v1beta1", namespace: "silo-1-computers", plural: "sandboxclaims",
			body: expect.objectContaining({
				metadata: expect.objectContaining({ name: "computer-1-g2", annotations: { "opencrane.ai/lease-reason": "activation_requested" } }),
				spec: {
					warmPoolRef: { name: "developer-pool" },
					lifecycle: { shutdownPolicy: "DeleteForeground", shutdownTime: "2026-09-05T12:00:00Z" },
					additionalPodMetadata: { labels: { "opencrane.ai/computer-id": "computer-1", "opencrane.ai/computer-generation": "2", "opencrane.ai/computer-lease-id": "lease-2" } },
				},
			}),
		}));
	});

	it("reads the assigned Sandbox's address before Ready and accepts controller bookkeeping", async function _ObserveClaim()
	{
		const api = _Api();
		const result = await new AgentSandboxClaimAdapter(api as never).claim(_Command());
		expect(result).toEqual({ claimId: "computer-1-g2", outcome: "existing", sandboxId: "sandbox-2", serviceFQDN: "sandbox-2-service.silo-1-computers.svc.cluster.local" });
		expect(api.getNamespacedCustomObject.mock.calls).toEqual([
			[{ group: "extensions.agents.x-k8s.io", version: "v1beta1", namespace: "silo-1-computers", plural: "sandboxclaims", name: "computer-1-g2" }],
			[{ group: "agents.x-k8s.io", version: "v1beta1", namespace: "silo-1-computers", plural: "sandboxes", name: "sandbox-2" }],
		]);
		expect(api.createNamespacedCustomObject).not.toHaveBeenCalled();
	});

	it("recovers a create race by validating the winner and its assigned Sandbox", async function _CreateRace()
	{
		const api = _Api();
		api.getNamespacedCustomObject.mockRejectedValueOnce({ code: 404 });
		api.createNamespacedCustomObject.mockRejectedValueOnce({ code: 409 });
		await expect(new AgentSandboxClaimAdapter(api as never).claim(_Command())).resolves.toMatchObject({ outcome: "existing", sandboxId: "sandbox-2" });
	});

	it("accepts the upstream optional empty Pod annotations map without allowing additions", async function _EmptyPodAnnotations()
	{
		const claim = _Claim();
		const api = _Api({ ...claim, spec: { ...claim.spec, additionalPodMetadata: { ...claim.spec.additionalPodMetadata, annotations: {} } } });
		await expect(new AgentSandboxClaimAdapter(api as never).claim(_Command())).resolves.toMatchObject({ outcome: "existing" });
	});

	it.each([
		["lease reason", { annotations: { "opencrane.ai/lease-reason": "recovery_requested" } }],
		["unknown annotation", { annotations: { ..._Claim().metadata.annotations, "custom.example/key": "value" } }],
		["uninstalled webhook annotation", { annotations: { ..._Claim().metadata.annotations, "agents.x-k8s.io/webhook-first-observed-at": "2026-09-05T11:00:00Z" } }],
		["lease label", { labels: { ..._Claim().metadata.labels, "opencrane.ai/computer-lease-id": "other-lease" } }],
		["profile label", { labels: { ..._Claim().metadata.labels, "opencrane.ai/profile": "other-profile" } }],
		["extra label", { labels: { ..._Claim().metadata.labels, "custom.example/key": "value" } }],
	])("rejects an existing claim with conflicting %s", async function _RejectMetadata(_name, metadata)
	{
		const claim = _Claim();
		const api = _Api({ ...claim, metadata: { ...claim.metadata, ...metadata } });
		await expect(new AgentSandboxClaimAdapter(api as never).claim(_Command())).rejects.toThrow(/conflicts/);
		expect(api.getNamespacedCustomObject).toHaveBeenCalledOnce();
	});

	it.each([
		["pool", { warmPoolRef: { name: "other-pool" } }],
		["policy", { lifecycle: { ..._Claim().spec.lifecycle, shutdownPolicy: "Retain" } }],
		["expiry", { lifecycle: { ..._Claim().spec.lifecycle, shutdownTime: "2026-09-05T13:00:00Z" } }],
		["TTL", { lifecycle: { ..._Claim().spec.lifecycle, ttlSecondsAfterFinished: 1 } }],
		["environment", { env: [{ name: "COMMAND", value: "untrusted" }] }],
		["volumes", { volumeClaimTemplates: [] }],
		["copied lease", { additionalPodMetadata: { labels: { ..._Claim().spec.additionalPodMetadata.labels, "opencrane.ai/computer-lease-id": "other-lease" } } }],
		["Pod annotation", { additionalPodMetadata: { ..._Claim().spec.additionalPodMetadata, annotations: { "custom.example/key": "value" } } }],
	])("rejects an existing claim with conflicting %s", async function _RejectSpec(_name, spec)
	{
		const claim = _Claim();
		const api = _Api({ ...claim, spec: { ...claim.spec, ...spec } });
		await expect(new AgentSandboxClaimAdapter(api as never).claim(_Command())).rejects.toThrow(/conflicts/);
	});

	it.each([
		["API group", { apiVersion: "foreign.example/v1beta1" }],
		["API version", { apiVersion: "extensions.agents.x-k8s.io/v1alpha1" }],
		["kind", { kind: "OtherClaim" }],
		["name", { name: "another-claim" }],
		["UID", { uid: "replacement-claim-uid" }],
		["controller flag", { controller: false }],
	])("rejects a Sandbox with the wrong owner %s", async function _RejectSandboxOwner(_name, changes)
	{
		const sandbox = _Sandbox();
		sandbox.metadata.ownerReferences[0] = { ...sandbox.metadata.ownerReferences[0], ...changes };
		await expect(new AgentSandboxClaimAdapter(_Api(_Claim(), sandbox) as never).claim(_Command())).rejects.toThrow(/does not belong/);
	});

	it.each([
		["namespace", { metadata: { ..._Sandbox().metadata, namespace: "foreign-computers" } }],
		["name", { metadata: { ..._Sandbox().metadata, name: "other-sandbox" } }],
		["missing owner", { metadata: { ..._Sandbox().metadata, ownerReferences: [] } }],
		["duplicate controllers", { metadata: { ..._Sandbox().metadata, ownerReferences: [_Sandbox().metadata.ownerReferences[0], _Sandbox().metadata.ownerReferences[0]] } }],
		["API group", { apiVersion: "extensions.agents.x-k8s.io/v1beta1" }],
		["kind", { kind: "SandboxClaim" }],
	])("rejects a Sandbox with mismatched %s", async function _RejectSandboxIdentity(_name, changes)
	{
		const api = _Api(_Claim(), { ..._Sandbox(), ...changes });
		await expect(new AgentSandboxClaimAdapter(api as never).inspect(_LeaseCommand())).rejects.toThrow(/does not belong/);
	});

	it.each([
		"https://sandbox-2-service.silo-1-computers.svc.cluster.local",
		"sandbox-2-service.foreign-computers.svc.cluster.local",
		"unrelated-service.silo-1-computers.svc.cluster.local",
		"sandbox-2-service.silo-1-computers.svc.cluster.local.attacker.example",
		"10.1.2.3",
	])("rejects the controller-reported address %s", async function _RejectAddress(serviceFQDN)
	{
		const sandbox = _Sandbox();
		sandbox.status.serviceFQDN = serviceFQDN;
		await expect(new AgentSandboxClaimAdapter(_Api(_Claim(), sandbox) as never).inspect(_LeaseCommand())).rejects.toThrow(/Service address/);
	});

	it("keeps a missing or not-yet-addressed Sandbox pending without guessing its address", async function _PendingSandbox()
	{
		const adapter = new AgentSandboxClaimAdapter(_Api(_Claim(), null) as never);
		await expect(adapter.claim(_Command())).resolves.toMatchObject({ sandboxId: "sandbox-2", serviceFQDN: null });
		const sandbox = _Sandbox();
		const pending = { ...sandbox, status: { conditions: sandbox.status.conditions } };
		await expect(new AgentSandboxClaimAdapter(_Api(_Claim(), pending) as never).inspect(_LeaseCommand())).resolves.toMatchObject({ sandboxId: "sandbox-2", serviceFQDN: null });
	});

	it("does not consume a fabricated Service address from claim status", async function _RejectClaimServiceFallback()
	{
		const claim = { ..._Claim(), status: { sandbox: { serviceFQDN: "forged.silo-1-computers.svc.cluster.local" } } };
		const api = _Api(claim);
		await expect(new AgentSandboxClaimAdapter(api as never).claim(_Command())).resolves.toMatchObject({ sandboxId: null, serviceFQDN: null });
		expect(api.getNamespacedCustomObject).toHaveBeenCalledOnce();
	});

	it("rejects a malformed Sandbox name before making a second Kubernetes read", async function _RejectSandboxName()
	{
		const claim = _Claim();
		claim.status.sandbox.name = "../foreign/sandbox";
		const api = _Api(claim);
		await expect(new AgentSandboxClaimAdapter(api as never).claim(_Command())).rejects.toThrow(/invalid Sandbox name/);
		expect(api.getNamespacedCustomObject).toHaveBeenCalledOnce();
	});

	it("releases a matching claim with UID and resource-version delete preconditions", async function _ReleaseClaim()
	{
		const api = _Api();
		await expect(new AgentSandboxClaimAdapter(api as never).release(_LeaseCommand())).resolves.toBe("released");
		expect(api.deleteNamespacedCustomObject).toHaveBeenCalledWith(expect.objectContaining({ name: "computer-1-g2", body: { propagationPolicy: "Foreground", preconditions: { uid: "claim-uid", resourceVersion: "73" } } }));
	});

	it("renews with a merge patch that preserves controller metadata and compares the read version", async function _RenewClaim()
	{
		const api = _Api();
		const adapter = new AgentSandboxClaimAdapter(api as never);
		await expect(adapter.renew({ ..._LeaseCommand(), expiresAt: "2026-09-05T13:00:00.123Z" })).resolves.toBe("renewed");
		expect(api.patchNamespacedCustomObject).toHaveBeenCalledWith(expect.objectContaining({ name: "computer-1-g2", plural: "sandboxclaims", body: { metadata: { uid: "claim-uid", resourceVersion: "73" }, spec: { lifecycle: { shutdownTime: "2026-09-05T13:00:00Z" } } } }), expect.anything());
		const requestOptions = api.patchNamespacedCustomObject.mock.calls[0][1];
		const headers: Record<string, string> = {};
		await requestOptions.middleware[0].pre({ setHeaderParam: function _SetHeader(key: string, value: string) { headers[key] = value; } });
		expect(headers["Content-Type"]).toBe("application/merge-patch+json");
		await expect(adapter.renew({ ..._LeaseCommand(), expiresAt: "2026-09-05T12:00:00.999Z" })).rejects.toThrow(/later/);
		expect(api.patchNamespacedCustomObject).toHaveBeenCalledOnce();
	});

	it("propagates replacement and concurrent-change conflicts without retrying a mutation", async function _MutationConflict()
	{
		const api = _Api();
		api.patchNamespacedCustomObject.mockRejectedValue({ code: 409 });
		api.deleteNamespacedCustomObject.mockRejectedValue({ code: 409 });
		const adapter = new AgentSandboxClaimAdapter(api as never);
		await expect(adapter.renew({ ..._LeaseCommand(), expiresAt: "2026-09-05T13:00:00Z" })).rejects.toEqual({ code: 409 });
		await expect(adapter.release(_LeaseCommand())).rejects.toEqual({ code: 409 });
		expect(api.patchNamespacedCustomObject).toHaveBeenCalledOnce();
		expect(api.deleteNamespacedCustomObject).toHaveBeenCalledOnce();
	});

	it.each([
		{ uid: undefined }, { resourceVersion: undefined }, { namespace: "other-namespace" }, { name: "other-claim" },
	])("rejects a claim without the requested API identity: %j", async function _RejectClaimIdentity(metadata)
	{
		const claim = _Claim();
		const api = _Api({ ...claim, metadata: { ...claim.metadata, ...metadata } });
		const adapter = new AgentSandboxClaimAdapter(api as never);
		await expect(adapter.release(_LeaseCommand())).rejects.toThrow(/claim/);
		await expect(adapter.renew({ ..._LeaseCommand(), expiresAt: "2026-09-05T13:00:00Z" })).rejects.toThrow(/claim/);
		expect(api.deleteNamespacedCustomObject).not.toHaveBeenCalled();
		expect(api.patchNamespacedCustomObject).not.toHaveBeenCalled();
	});

	it("rejects changed lease labels for inspection, renewal and release", async function _RejectLease()
	{
		const api = _Api();
		const adapter = new AgentSandboxClaimAdapter(api as never);
		const stale = { ..._LeaseCommand(), leaseId: "foreign-lease" };
		await expect(adapter.inspect(stale)).rejects.toThrow(/does not match/);
		await expect(adapter.release(stale)).rejects.toThrow(/does not match/);
		await expect(adapter.renew({ ...stale, expiresAt: "2026-09-05T13:00:00Z" })).rejects.toThrow(/does not match/);
		expect(api.deleteNamespacedCustomObject).not.toHaveBeenCalled();
		expect(api.patchNamespacedCustomObject).not.toHaveBeenCalled();
	});

	it("reports an absent claim and tolerates a claim deleted after the release read", async function _AbsentClaim()
	{
		const adapter = new AgentSandboxClaimAdapter(_Api(null) as never);
		await expect(adapter.inspect(_LeaseCommand())).resolves.toBeNull();
		await expect(adapter.release(_LeaseCommand())).resolves.toBe("absent");
		await expect(adapter.renew({ ..._LeaseCommand(), expiresAt: "2026-09-05T13:00:00Z" })).resolves.toBe("absent");
		const api = _Api();
		api.deleteNamespacedCustomObject.mockRejectedValue({ code: 404 });
		await expect(new AgentSandboxClaimAdapter(api as never).release(_LeaseCommand())).resolves.toBe("released");
	});
});
