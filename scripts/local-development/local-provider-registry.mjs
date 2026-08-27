import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const _DEFAULT_REGISTRY_PATH = fileURLToPath(new URL("../../libs/models/local-development/main/provider-contract.json", import.meta.url));
const _PROVIDER_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const _MODEL_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._:/-]*$/;

/**
 * Reads the reviewed local provider contract and rejects ambiguous provider or model ownership.
 *
 * Called by: `resolveLocalProviderSelection` when it discovers configured providers, and
 * `getReviewedLocalProviderKeyPaths` when it separates local provider credentials from a remote
 * LiteLLM admin key.
 * @param {string} registryPath - JSON contract path to read.
 * @returns The unique reviewed providers and their exact model names.
 * @throws When the contract is unreadable, empty, malformed, or repeats an authority.
 */
export function readLocalProviderRegistry(registryPath)
{
	let contract;

	try
	{
		contract = JSON.parse(fs.readFileSync(registryPath, "utf8"));
	}
	catch (error)
	{
		throw new Error(`The reviewed local model registry is invalid: ${error.message}`);
	}

	if (!Array.isArray(contract.providers) || contract.providers.length === 0)
	{
		throw new Error("The reviewed local model registry must contain at least one provider");
	}

	const providerNames = new Set();
	const modelNames = new Set();

	for (const provider of contract.providers)
	{
		if (!provider || !_PROVIDER_NAME_PATTERN.test(provider.name))
		{
			throw new Error("Every reviewed local model provider must have a lowercase provider name");
		}

		if (providerNames.has(provider.name))
		{
			throw new Error(`The reviewed local model registry repeats provider ${provider.name}`);
		}

		if (!Array.isArray(provider.models) || provider.models.length === 0 || !provider.models.includes(provider.defaultModel))
		{
			throw new Error(`Provider ${provider.name} must list its default model`);
		}

		providerNames.add(provider.name);

		for (const model of provider.models)
		{
			if (!_MODEL_NAME_PATTERN.test(model))
			{
				throw new Error(`Provider ${provider.name} contains an invalid model name`);
			}

			if (modelNames.has(model))
			{
				throw new Error(`The reviewed local model registry repeats model ${model}`);
			}

			modelNames.add(model);
		}
	}

	return contract.providers;
}

/**
 * Derives the hidden credential filename for a provider admitted by the reviewed registry.
 * Every provider follows `.<provider>-key`; both selection and remote-key separation use this
 * function so they cannot disagree on a path.
 *
 * Called by: `resolveLocalProviderSelection` and `getReviewedLocalProviderKeyPaths`.
 * @param {{ name: string }} provider - Reviewed provider whose credential path is being built.
 * @returns {string} Filename expected directly under the repository's `keys/` directory.
 */
export function createLocalProviderKeyFileName(provider)
{
	return `.${provider.name}-key`;
}

/**
 * Returns every reviewed provider-key path so remote credentials cannot reuse a local provider file.
 *
 * Called by: `createLocalDevelopmentConfiguration` when it builds the Tier 2 credential boundary.
 * @param {string} repositoryRoot - OpenCrane repository root that contains `keys/`.
 * @returns {string[]} Absolute conventional key paths for every reviewed provider.
 * @throws When the reviewed provider registry is unreadable or invalid.
 */
export function getReviewedLocalProviderKeyPaths(repositoryRoot)
{
	return readLocalProviderRegistry(_DEFAULT_REGISTRY_PATH).map(provider => path.join(repositoryRoot, "keys", createLocalProviderKeyFileName(provider)));
}
