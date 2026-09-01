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

function _findProviderByName(providers, requestedProvider)
{
	if (!requestedProvider)
	{
		return undefined;
	}

	const provider = providers.find(candidate => candidate.name === requestedProvider);

	if (!provider)
	{
		throw new Error(`Provider ${requestedProvider} is not listed in the reviewed local model registry`);
	}

	return provider;
}

function _findProviderByModel(providers, requestedModel)
{
	if (!requestedModel)
	{
		return undefined;
	}

	const provider = providers.find(candidate => candidate.models.includes(requestedModel));

	if (!provider)
	{
		throw new Error(`Model ${requestedModel} is not listed in the reviewed local model registry`);
	}

	return provider;
}

function _selectProvider(providers, configuredProviders, requestedProvider, requestedModel)
{
	const namedProvider = _findProviderByName(providers, requestedProvider);
	const modelProvider = _findProviderByModel(providers, requestedModel);

	if (namedProvider && modelProvider && namedProvider.name !== modelProvider.name)
	{
		throw new Error(`Model ${requestedModel} does not belong to provider ${requestedProvider}`);
	}

	const provider = namedProvider ?? modelProvider ?? configuredProviders[0];

	if (!configuredProviders.some(candidate => candidate.name === provider.name))
	{
		throw new Error(`Provider ${provider.name} requires the missing key file keys/${createLocalProviderKeyFileName(provider)}`);
	}

	return {
		provider,
		model: requestedModel ?? provider.defaultModel
	};
}

/**
 * Matches conventional key filenames to reviewed providers and resolves the model for this run.
 * An explicit provider uses its `defaultModel` unless the caller also selects one of its models;
 * a model supplied without a provider selects its owner. When neither is supplied, the first
 * recognized key filename selects the provider and that provider's `defaultModel`. A recognized
 * symlink remains selected so secret loading rejects it instead of falling through to another key.
 *
 * Called by: `prepareLocalProviderConfiguration` before any provider key is read.
 * @param {ReturnType<typeof import("./configuration.mjs").createLocalDevelopmentConfiguration>} configuration - Registry, key-directory, and optional provider/model selection.
 * @returns The selected reviewed provider, its model, and its conventional key path.
 * @throws When the key directory is missing, no recognized key exists, or the requested provider and model are invalid or disagree.
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

	const selection = _selectProvider(providers, configuredProviders, configuration.provider, configuration.model);

	return {
		selectedProvider: selection.provider,
		selectedModel: selection.model,
		providerKeyPath: path.join(configuration.providerKeysDirectory, createLocalProviderKeyFileName(selection.provider))
	};
}
