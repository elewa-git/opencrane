import { _ProvisionByokKey, _RequireLiteLlmModelName } from "@opencrane/backend/server/gateways/model-routing";

import type { InitialModelBootstrapDependencies } from "./initial-model-bootstrap.types";
import { _log } from "./log";

/**
 * Seed the configured initial provider key and exact reviewed model through the same custody,
 * LiteLLM registration, and model-routing authority used by the authenticated BYOK API. Returning
 * normally proves LiteLLM accepted the credential and exposes that exact model; a failure
 * deliberately prevents this deployment from serving an agent that cannot call its selected model.
 *
 * @param dependencies - Composed product persistence, Secret-custody, and deployment configuration dependencies.
 * @see _ProvisionByokKey
 */
export async function _BootstrapInitialModel(dependencies: InitialModelBootstrapDependencies): Promise<void>
{
	const { prisma, coreApi, config, namespace } = dependencies;
	if (!config)
	{
		return;
	}

	const apiKey = config.apiKey;
	config.apiKey = "";
	delete process.env.OPENCRANE_INITIAL_MODEL_API_KEY;
	try
	{
		const result = await _ProvisionByokKey({
			prisma,
			coreApi,
			operatorNamespace: namespace,
			provider: config.provider,
			selectedModel: config.model,
			apiKey,
			log: _log,
			requireLiveModels: true,
		});
		if (!result.litellmRegistered)
		{
			throw new Error(`Initial model provider '${config.provider}' was persisted but LiteLLM did not accept its credential`);
		}
		await _RequireLiteLlmModelName(config.model);
		_log.info({ provider: config.provider, model: config.model }, "initial model provider credential and exact model seeded through LiteLLM");
	}
	finally
	{
		config.apiKey = "";
		delete process.env.OPENCRANE_INITIAL_MODEL_API_KEY;
	}
}
