import { _ProvisionByokKey, _RequireLiteLlmModelName } from "@opencrane/backend/server/gateways/model-routing";

import type { InitialModelBootstrapDependencies } from "./initial-model-bootstrap.types";
import { _log } from "./log";

/**
 * Seed the configured initial provider key through the same custody, LiteLLM registration, and
 * model-catalogue authority used by the authenticated BYOK API. Returning normally proves
 * LiteLLM accepted the credential; a failure deliberately prevents this deployment from serving
 * an agent that cannot call a model.
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
	await _RequireLiteLlmModelName("auto");
	_log.info({ provider: config.provider }, "initial model provider credential seeded through LiteLLM");
}
