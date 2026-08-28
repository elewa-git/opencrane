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

/**
 * Resolves one reviewed provider/model pair without reading a credential.
 *
 * The optional fallback is the only implicit choice. Tier 2 supplies the first configured key in
 * sorted filename order, while Tier 3's environment-only path deliberately supplies no fallback.
 *
 * Called by: `resolveLocalProviderSelection` and the Tier 3 provider-backed profile.
 *
 * @param {string} registryPath - Reviewed provider registry to read.
 * @param {string | undefined} requestedProvider - Explicit provider name, when supplied.
 * @param {string | undefined} requestedModel - Explicit model name, when supplied.
 * @param {string | undefined} fallbackProvider - Reviewed provider selected by a credential source.
 * @returns {{ provider: ReturnType<typeof readLocalProviderRegistry>[number], model: string }} Exact reviewed selection.
 * @throws When provider/model ownership is invalid or no explicit/fallback provider exists.
 */
export function resolveReviewedProviderRequest(registryPath, requestedProvider, requestedModel, fallbackProvider)
{
	const providers = readLocalProviderRegistry(registryPath);
	const namedProvider = _findProviderByName(providers, requestedProvider);
	const modelProvider = _findProviderByModel(providers, requestedModel);

	if (namedProvider && modelProvider && namedProvider.name !== modelProvider.name)
	{
		throw new Error(`Model ${requestedModel} does not belong to provider ${requestedProvider}`);
	}

	const provider = namedProvider ?? modelProvider ?? providers.find(candidate => candidate.name === fallbackProvider);
	if (!provider)
	{
		throw new Error("Select a reviewed provider or model before supplying an environment-only provider key");
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

	const selection = resolveReviewedProviderRequest(
		configuration.localProviderRegistryPath,
		configuration.provider,
		configuration.model,
		configuredProviders[0].name
	);

	if (!configuredProviders.some(candidate => candidate.name === selection.provider.name))
	{
		throw new Error(`Provider ${selection.provider.name} requires the missing key file keys/${createLocalProviderKeyFileName(selection.provider)}`);
	}

	return {
		selectedProvider: selection.provider,
		selectedModel: selection.model,
		providerKeyPath: path.join(configuration.providerKeysDirectory, createLocalProviderKeyFileName(selection.provider))
	};
}
