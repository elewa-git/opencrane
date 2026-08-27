import fs from "node:fs";
import path from "node:path";

import { createLocalProviderKeyFileName, readLocalProviderRegistry } from "./local-provider-registry.mjs";

function _sortByKeyFile(left, right)
{
	const leftKeyFile = createLocalProviderKeyFileName(left);
	const rightKeyFile = createLocalProviderKeyFileName(right);

	if (leftKeyFile < rightKeyFile)
	{
		return -1;
	}

	if (leftKeyFile > rightKeyFile)
	{
		return 1;
	}

	return 0;
}

function _selectProvider(providers, configuredProviders, requestedModel)
{
	if (!requestedModel)
	{
		return {
			provider: configuredProviders[0],
			model: configuredProviders[0].defaultModel
		};
	}

	const provider = providers.find(candidate => candidate.models.includes(requestedModel));

	if (!provider)
	{
		throw new Error(`Model ${requestedModel} is not listed in the reviewed local model registry`);
	}

	if (!configuredProviders.some(candidate => candidate.name === provider.name))
	{
		throw new Error(`Model ${requestedModel} requires the missing key file keys/${createLocalProviderKeyFileName(provider)}`);
	}

	return {
		provider,
		model: requestedModel
	};
}

/**
 * Matches conventional key filenames to reviewed providers and resolves one deterministic model.
 * Hidden and unreviewed files never participate. A recognized symlink remains selected so secret
 * loading can reject that exact path instead of silently falling through to a later credential.
 *
 * Called by: `prepareLocalProviderConfiguration` before any provider key is read.
 * @param {ReturnType<typeof import("./configuration.mjs").createLocalDevelopmentConfiguration>} configuration - Registry, key-directory, and optional model selection.
 * @returns The selected reviewed provider, its model, and its conventional key path.
 * @throws When the key directory is missing, no recognized key exists, or model selection fails.
 */
export function resolveLocalProviderSelection(configuration)
{
	const providers = readLocalProviderRegistry(configuration.localProviderRegistryPath);
	let keyFileNames;

	try
	{
		keyFileNames = new Set(fs.readdirSync(configuration.providerKeysDirectory));
	}
	catch (error)
	{
		if (error?.code === "ENOENT")
		{
			throw new Error(`The local provider-key directory is missing: ${configuration.providerKeysDirectory}`);
		}

		throw error;
	}

	const configuredProviders = providers
		.filter(provider => keyFileNames.has(createLocalProviderKeyFileName(provider)))
		.sort(_sortByKeyFile);

	if (configuredProviders.length === 0)
	{
		const expectedNames = providers.map(createLocalProviderKeyFileName).sort().join(", ");

		throw new Error(`Alternative A requires one reviewed provider key in keys/: ${expectedNames}`);
	}

	const selection = _selectProvider(providers, configuredProviders, configuration.model);

	return {
		selectedProvider: selection.provider,
		selectedModel: selection.model,
		providerKeyPath: path.join(configuration.providerKeysDirectory, createLocalProviderKeyFileName(selection.provider))
	};
}
