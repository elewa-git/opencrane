import { describe, expect, it, vi } from "vitest";

import { _ProvisionByokKey, _RequireLiteLlmModelName } from "@opencrane/backend/server/gateways/model-routing";

import { _BootstrapInitialModel } from "../initial-model-bootstrap";
import type { InitialModelBootstrapDependencies } from "../initial-model-bootstrap.types";

vi.mock("@opencrane/backend/server/gateways/model-routing", function _ModelRoutingMock()
{
	return { _ProvisionByokKey: vi.fn(), _RequireLiteLlmModelName: vi.fn() };
});

/** Mock provider provisioning dependency with its real public signature. */
const _provisionByokKey = vi.mocked(_ProvisionByokKey);
const _requireLiteLlmModelName = vi.mocked(_RequireLiteLlmModelName);

/** Build only the dependencies the composition seam forwards to provider-key custody. */
function _Dependencies(config: InitialModelBootstrapDependencies["config"]): InitialModelBootstrapDependencies
{
	return {
		prisma: {} as InitialModelBootstrapDependencies["prisma"],
		coreApi: {} as InitialModelBootstrapDependencies["coreApi"],
		config,
		namespace: "opencrane-testv2",
	};
}

describe("initial model bootstrap", function _InitialModelBootstrapSuite()
{
	it("does nothing when the deployment does not configure an initial model", async function _NoConfiguredModel()
	{
		await _BootstrapInitialModel(_Dependencies(null));
		expect(_provisionByokKey).not.toHaveBeenCalled();
	});

	it("uses the provider custody authority and refuses readiness when LiteLLM rejects the key", async function _RequireLiteLlmRegistration()
	{
		_provisionByokKey.mockResolvedValueOnce({ litellmRegistered: true, row: {} as never });
		_requireLiteLlmModelName.mockResolvedValueOnce();
		await expect(_BootstrapInitialModel(_Dependencies({ provider: "openai", apiKey: "sk-test" }))).resolves.toBeUndefined();
		expect(_provisionByokKey).toHaveBeenCalledWith(expect.objectContaining({ operatorNamespace: "opencrane-testv2", provider: "openai", apiKey: "sk-test", requireLiveModels: true }));
		expect(_requireLiteLlmModelName).toHaveBeenCalledWith("auto");

		_provisionByokKey.mockResolvedValueOnce({ litellmRegistered: false, row: {} as never });
		await expect(_BootstrapInitialModel(_Dependencies({ provider: "openai", apiKey: "sk-test" }))).rejects.toThrow(/LiteLLM did not accept/);
	});

	it("refuses readiness when the accepted provider key has no live auto model", async function _RequireLiveModel()
	{
		_provisionByokKey.mockResolvedValueOnce({ litellmRegistered: true, row: {} as never });
		_requireLiteLlmModelName.mockRejectedValueOnce(new Error("LiteLLM has not registered required model 'auto'"));
		await expect(_BootstrapInitialModel(_Dependencies({ provider: "openai", apiKey: "sk-test" }))).rejects.toThrow(/required model 'auto'/);
	});
});
