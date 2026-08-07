import { _ProvisionByokKey, _RequireLiteLlmModelRegistration } from "@opencrane/backend/server/gateways/model-routing";

import type { InitialModelBootstrapDependencies } from "./initial-model-bootstrap.types.js";
import { _log } from "./log.js";

/**
 * Seed the configured initial provider key through the same custody, LiteLLM registration, and
 * model-catalogue authority used by the authenticated BYOK API. Returning normally proves
 * LiteLLM accepted the credential; a failure deliberately prevents this deployment from serving
 * an agent that cannot call a model.
 *
 * @param dependencies - Composed product persistence, Secret-custody, and deployment configuration dependencies.
 */
export async function _BootstrapInitialModel(dependencies: InitialModelBootstrapDependencies): Promise<void>
{
	const { prisma, coreApi, config, namespace } = dependencies;
	if (!config)
	{
		return;
	}

	const result = await _ProvisionByokKey({
		prisma,
		coreApi,
		operatorNamespace: namespace,
		provider: config.provider,
		apiKey: config.apiKey,
		log: _log,
		requireLiveModels: true,
	});
	if (!result.litellmRegistered)
	{
		throw new Error(`Initial model provider '${config.provider}' was persisted but LiteLLM did not accept its credential`);
	}
	await _RequireLiteLlmModelRegistration("auto");
	_log.info({ provider: config.provider }, "initial model provider credential seeded through LiteLLM");
}
