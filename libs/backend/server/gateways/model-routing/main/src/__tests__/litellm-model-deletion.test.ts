import { afterEach, describe, expect, it, vi } from "vitest";

import type { Logger } from "@opencrane/backend/observability";
import { ModelRoutingScope } from "@opencrane/contracts";

import { _ConvergeLiteLlmModelDeployment, _RetireLiteLlmModelDeployments } from "../core/litellm-model-deletion";
import type { LiteLlmModelDeploymentTarget } from "../core/litellm-model-deletion.types";
import type { LiteLlmModelRegistration } from "../core/litellm-model-registration.types";

/** Logger fake that records outcomes without writing test output. */
const _LOGGER = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger;

/** Registration coordinates used by the stable-deployment convergence tests. */
const _REGISTRATION: LiteLlmModelRegistration = {
	deploymentId: "stable-deployment",
	publicModelName: "openai/gpt-5.5",
	upstreamModel: "openai/gpt-5.5",
	scope: ModelRoutingScope.Global,
	clusterTenant: null,
	apiBase: null,
	apiKeyEnvRef: null,
	litellmCredentialName: "byok-openai",
	requireLiveRegistration: true,
};

/** Builds one complete LiteLLM inventory row from a deployment target. */
function _entry(target: LiteLlmModelDeploymentTarget): Record<string, unknown>
{
	return {
		model_name: target.publicModelName,
		litellm_params: {
			model: target.upstreamModel,
			...(target.apiBase === null ? {} : { api_base: target.apiBase }),
			...(target.apiKeyReference === null ? {} : { api_key: target.apiKeyReference }),
			...(target.litellmCredentialName === null ? {} : { litellm_credential_name: target.litellmCredentialName }),
		},
		model_info: { id: target.deploymentId, ...(target.mode === "chat" ? {} : { mode: target.mode }) },
	};
}

/** Builds the expected chat coordinates for a named deployment id. */
function _chatTarget(deploymentId: string, publicModelName = "openai/gpt-5.5", upstreamModel = "openai/gpt-5.5"): LiteLlmModelDeploymentTarget
{
	return { deploymentId, publicModelName, upstreamModel, apiBase: null, apiKeyReference: null, litellmCredentialName: "byok-openai", mode: "chat" };
}

/** Installs a mutable LiteLLM inventory fake and returns every deleted id. */
function _installLiteLlmFake(initial: readonly LiteLlmModelDeploymentTarget[], deleteStatus = 200): { readonly deleted: string[]; readonly inventory: () => readonly LiteLlmModelDeploymentTarget[] }
{
	let inventory = [...initial];
	const deleted: string[] = [];
	vi.stubGlobal("fetch", vi.fn(async function _Fetch(url: string, init?: RequestInit): Promise<Response>
	{
		if (url.endsWith("/model/info"))
			return new Response(JSON.stringify({ data: inventory.map(_entry) }), { status: 200 });
		if (url.endsWith("/model/delete"))
		{
			const body = JSON.parse(String(init?.body ?? "{}")) as { id?: unknown };
			const id = typeof body.id === "string" ? body.id : "";
			deleted.push(id);
			if (deleteStatus >= 200 && deleteStatus < 300)
				inventory = inventory.filter(deployment => deployment.deploymentId !== id);
			return new Response("{}", { status: deleteStatus });
		}
		return new Response("not found", { status: 404 });
	}));
	return { deleted, inventory: function _Inventory() { return inventory; } };
}

describe("LiteLLM exact deployment convergence", function _Suite()
{
	afterEach(function _Restore()
	{
		vi.unstubAllGlobals();
		vi.unstubAllEnvs();
		vi.clearAllMocks();
	});

	it("removes every matching legacy copy while preserving the admitted deployment", async function _PrunesLegacyCopies()
	{
		const duplicates = Array.from({ length: 48 }, function _Duplicate(_value, index) { return _chatTarget(`legacy-${index}`); });
		const fake = _installLiteLlmFake([_chatTarget("stable-deployment"), ...duplicates]);

		await expect(_ConvergeLiteLlmModelDeployment("http://litellm", "master", _REGISTRATION, _LOGGER)).resolves.toBe("stable-deployment");

		expect(fake.deleted).toEqual(duplicates.map(deployment => deployment.deploymentId));
		expect(fake.inventory()).toEqual([_chatTarget("stable-deployment")]);
	});

	it("removes matching legacy ids before the stable deployment is created", async function _ClearsLegacyOnlyInventory()
	{
		const fake = _installLiteLlmFake([_chatTarget("legacy-a"), _chatTarget("legacy-b")]);

		await expect(_ConvergeLiteLlmModelDeployment("http://litellm", "master", _REGISTRATION, _LOGGER)).resolves.toBeNull();

		expect(fake.deleted).toEqual(["legacy-a", "legacy-b"]);
		expect(fake.inventory()).toEqual([]);
	});

	it("does not delete a same-name deployment with different coordinates", async function _RejectsCoordinateMismatch()
	{
		const fake = _installLiteLlmFake([_chatTarget("stable-deployment"), _chatTarget("foreign", "openai/gpt-5.5", "openai/gpt-4o")]);

		await expect(_ConvergeLiteLlmModelDeployment("http://litellm", "master", _REGISTRATION, _LOGGER)).rejects.toThrow("does not match");

		expect(fake.deleted).toEqual([]);
	});

	it("retires stable and duplicate provider deployments by their exact ids", async function _RetiresProviderModels()
	{
		vi.stubEnv("LITELLM_ENDPOINT", "http://litellm");
		vi.stubEnv("LITELLM_MASTER_KEY", "master");
		const target = _chatTarget("stable-deployment");
		const unrelated = { ..._chatTarget("other", "anthropic/claude", "anthropic/claude"), litellmCredentialName: "byok-anthropic" };
		const fake = _installLiteLlmFake([target, _chatTarget("legacy-a"), unrelated]);

		await expect(_RetireLiteLlmModelDeployments([target], "byok-openai", _LOGGER)).resolves.toBeUndefined();

		expect(fake.deleted).toEqual(["stable-deployment", "legacy-a"]);
		expect(fake.inventory()).toEqual([unrelated]);
	});

	it("retains the provider barrier for an unadmitted deployment that uses the credential", async function _RejectsUnknownCredentialUse()
	{
		vi.stubEnv("LITELLM_ENDPOINT", "http://litellm");
		vi.stubEnv("LITELLM_MASTER_KEY", "master");
		const fake = _installLiteLlmFake([_chatTarget("stable-deployment"), _chatTarget("unknown", "openai/unknown", "openai/unknown")]);

		await expect(_RetireLiteLlmModelDeployments([_chatTarget("stable-deployment")], "byok-openai", _LOGGER)).rejects.toThrow("not admitted");

		expect(fake.deleted).toEqual([]);
	});

	it("retains the provider barrier when LiteLLM rejects an exact deletion", async function _RetainsRejectedDeletion()
	{
		vi.stubEnv("LITELLM_ENDPOINT", "http://litellm");
		vi.stubEnv("LITELLM_MASTER_KEY", "master");
		const fake = _installLiteLlmFake([_chatTarget("stable-deployment")], 500);

		await expect(_RetireLiteLlmModelDeployments([_chatTarget("stable-deployment")], "byok-openai", _LOGGER)).rejects.toThrow("HTTP 500");

		expect(fake.deleted).toEqual(["stable-deployment"]);
		expect(fake.inventory()).toEqual([_chatTarget("stable-deployment")]);
	});
});
