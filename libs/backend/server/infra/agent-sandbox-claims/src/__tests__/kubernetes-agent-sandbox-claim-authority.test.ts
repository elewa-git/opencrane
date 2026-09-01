import type { CustomObjectsApi } from "@kubernetes/client-node";
import { describe, expect, it, vi } from "vitest";

vi.mock("@opencrane/backend/observability", function _MockObservability()
{
	return {
		___DoWithTrace: async function _DoWithTrace<Result>(_name: string, _fields: Readonly<Record<string, unknown>>, operation: () => Promise<Result>): Promise<Result>
		{
			return operation();
		},
	};
});

import { AgentSandboxClaimReason, type AgentSandboxClaimCommand, type AgentSandboxClaimCustomObjectsApi } from "../agent-sandbox-claims.types";
import { _KubernetesAgentSandboxClaimAuthority } from "../kubernetes-agent-sandbox-claim-authority";

/** Builds the valid command produced after ConversationComputer activation admission. */
function _command(overrides: Partial<AgentSandboxClaimCommand> = {}): AgentSandboxClaimCommand
{
	return {
		namespace: "testv5",
		siloId: "testv5",
		computerId: "computer-41",
		generation: 2,
		profile: "personal",
		warmPoolName: "personal-pool",
		reason: AgentSandboxClaimReason.ActivationRequested,
		shutdownTime: new Date("2026-09-01T06:00:00.000Z"),
		...overrides,
	};
}

/** Builds the two-method Kubernetes client this authority is allowed to use. */
function _api(): { readonly api: AgentSandboxClaimCustomObjectsApi; readonly create: ReturnType<typeof vi.fn>; readonly get: ReturnType<typeof vi.fn> }
{
	const create = vi.fn().mockResolvedValue({});
	const get = vi.fn();
	return { api: { createNamespacedCustomObject: create, getNamespacedCustomObject: get }, create, get };
}

/** Confirms the narrow port accepts the public object-parameter Kubernetes client API. */
function _realCustomObjectsApi(api: CustomObjectsApi): AgentSandboxClaimCustomObjectsApi
{
	return api;
}

/** Recreates the resource body Kubernetes returns for an idempotent existing-claim read. */
function _claim(command: AgentSandboxClaimCommand, includeServerMetadata = false): Record<string, unknown>
{
	return {
		apiVersion: "extensions.agents.x-k8s.io/v1beta1",
		kind: "SandboxClaim",
		metadata: {
			name: `${command.computerId}-g${command.generation}`,
			namespace: command.namespace,
			labels: {
				"opencrane.ai/silo-id": command.siloId,
				"opencrane.ai/computer-id": command.computerId,
				"opencrane.ai/computer-generation": String(command.generation),
				"opencrane.ai/profile": command.profile,
			},
			annotations: { "opencrane.ai/lease-reason": command.reason },
			...(includeServerMetadata ? { creationTimestamp: "2026-09-01T00:00:00.000Z" } : {}),
		},
		spec: {
			warmPoolRef: { name: command.warmPoolName },
			lifecycle: { shutdownPolicy: "DeleteForeground", shutdownTime: command.shutdownTime.toISOString() },
		},
	};
}

describe("_KubernetesAgentSandboxClaimAuthority", function _ClaimAuthoritySuite()
{
	it("accepts the public object-parameter CustomObjectsApi when server composition arrives", function _AcceptsKubernetesClient()
	{
		const realApi = {} as CustomObjectsApi;

		expect(_realCustomObjectsApi(realApi)).toBe(realApi);
	});

	it("creates the exact admission-policy-safe deterministic claim", async function _CreatesClaim()
	{
		const { api, create } = _api();
		const command = _command();

		await expect(new _KubernetesAgentSandboxClaimAuthority(api).ensure(command)).resolves.toEqual({ namespace: "testv5", claimName: "computer-41-g2", disposition: "created" });

		expect(create).toHaveBeenCalledWith({
			group: "extensions.agents.x-k8s.io",
			version: "v1beta1",
			namespace: "testv5",
			plural: "sandboxclaims",
			body: _claim(command),
		});
	});

	it("accepts a 409 only after an exact get confirms the immutable prior lease", async function _AcceptsExactExistingClaim()
	{
		const { api, create, get } = _api();
		const command = _command();
		create.mockRejectedValue(Object.assign(new Error("already exists"), { code: 409 }));
		get.mockResolvedValue(_claim(command, true));

		await expect(new _KubernetesAgentSandboxClaimAuthority(api).ensure(command)).resolves.toEqual({ namespace: "testv5", claimName: "computer-41-g2", disposition: "existing" });

		expect(get).toHaveBeenCalledWith({ group: "extensions.agents.x-k8s.io", version: "v1beta1", namespace: "testv5", plural: "sandboxclaims", name: "computer-41-g2" });
	});

	it("rejects a 409 claim that would attach the generation to a different profile", async function _RejectsDifferentLease()
	{
		const { api, create, get } = _api();
		const command = _command();
		create.mockRejectedValue(Object.assign(new Error("already exists"), { response: { statusCode: 409 } }));
		get.mockResolvedValue(_claim(_command({ profile: "managed" }), true));

		await expect(new _KubernetesAgentSandboxClaimAuthority(api).ensure(command)).rejects.toThrow("conflicts with a different immutable lease");
	});

	it("does not call Kubernetes for malformed computer or generation coordinates", async function _RejectsMalformedCommand()
	{
		const { api, create, get } = _api();

		await expect(new _KubernetesAgentSandboxClaimAuthority(api).ensure(_command({ computerId: "run-41", generation: 0 }))).rejects.toThrow("computerId");

		expect(create).not.toHaveBeenCalled();
		expect(get).not.toHaveBeenCalled();
	});

	it("propagates a non-conflict Kubernetes failure without a read", async function _PropagatesFailure()
	{
		const { api, create, get } = _api();
		create.mockRejectedValue(Object.assign(new Error("forbidden"), { statusCode: 403 }));

		await expect(new _KubernetesAgentSandboxClaimAuthority(api).ensure(_command())).rejects.toThrow("forbidden");

		expect(get).not.toHaveBeenCalled();
	});
});
