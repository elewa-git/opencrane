import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createCodespacesProviderKeyEnvironmentVariable, discoverCodespacesProviderCredentials } from "./codespaces-provider-credentials.mjs";

const _DEFAULT_CATALOG_PATH = fileURLToPath(new URL("../../../../libs/backend/server/gateways/model-routing/main/byok-provider-catalog.json", import.meta.url));
const _PROVIDER_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const _MODEL_PATTERN = /^[a-z0-9][a-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._:/-]*$/;

function _requireOwnerOnlyCredential(credentialPath)
{
	let statistics;

	try
	{
		statistics = fs.lstatSync(credentialPath);
	}
	catch (error)
	{
		if (error?.code === "ENOENT")
		{
			throw new Error(`The model credential file is missing: ${credentialPath}`);
		}

		throw error;
	}

	if (statistics.isSymbolicLink() || !statistics.isFile())
	{
		throw new Error(`The model credential must be a regular, non-symbolic-link file: ${credentialPath}`);
	}

	if ((statistics.mode & 0o077) !== 0)
	{
		throw new Error(`The model credential must be readable only by its owner: ${credentialPath}`);
	}
}

function _findRequestedProvider(providers, providerName, modelName)
{
	const namedProvider = providerName
		? providers.find((provider) => provider.name === providerName)
		: undefined;
	const modelProvider = modelName
		? providers.find((provider) => provider.models.includes(modelName))
		: undefined;

	if (providerName && !namedProvider)
	{
		throw new Error(`Provider ${providerName} is not in the reviewed catalogue`);
	}

	if (modelName && !modelProvider)
	{
		throw new Error(`Model ${modelName} is not in the reviewed catalogue`);
	}

	if (
		namedProvider
		&& modelProvider
		&& namedProvider.name !== modelProvider.name
	)
	{
		throw new Error(`Model ${modelName} does not belong to provider ${providerName}`);
	}

	return namedProvider ?? modelProvider;
}

/**
 * Reads production's BYOK provider catalog and rejects repeated provider names or model IDs.
 *
 * Called by: local selection and remote-key separation.
 * @returns {{ name: string, litellmProvider: string, defaultModel: string, models: string[] }[]} Reviewed providers.
 */
export function readLocalProviderCatalog()
{
	let contract;

	try
	{
		contract = JSON.parse(fs.readFileSync(_DEFAULT_CATALOG_PATH, "utf8"));
	}
	catch (error)
	{
		throw new Error(`The reviewed provider catalogue is invalid: ${error.message}`);
	}

	if (
		!contract
		|| Array.isArray(contract)
		|| typeof contract !== "object"
	)
	{
		throw new Error("The reviewed provider catalogue must be an object");
	}

	const providers = Object.entries(contract).map(([name, provider]) =>
	{
		if (
			!provider
			|| typeof provider !== "object"
			|| Array.isArray(provider)
			|| !Array.isArray(provider.models)
		)
		{
			throw new Error(`Provider ${name} must declare its reviewed model catalogue`);
		}

		const validModels = provider.models.every((model) =>
		{
			return model
				&& typeof model === "object"
				&& !Array.isArray(model)
				&& typeof model.className === "string"
				&& typeof model.slug === "string";
		});

		if (
			!validModels
			|| typeof provider.defaultClass !== "string"
			|| typeof provider.litellmProvider !== "string"
		)
		{
			throw new Error(`Provider ${name} has invalid reviewed model entries`);
		}

		const defaultModel = provider.models.find((model) => model.className === provider.defaultClass);

		return {
			name,
			litellmProvider: provider.litellmProvider,
			defaultModel: defaultModel?.slug,
			models: provider.models.map((model) => model.slug)
		};
	});

	if (!providers.length)
	{
		throw new Error("The reviewed provider catalogue must contain at least one provider");
	}

	const providerNames = new Set();
	const modelNames = new Set();

	for (const provider of providers)
	{
		if (
			!provider
			|| !_PROVIDER_PATTERN.test(provider.name)
			|| !_PROVIDER_PATTERN.test(provider.litellmProvider)
		)
		{
			throw new Error("Every reviewed local provider must have lowercase provider names");
		}

		if (providerNames.has(provider.name))
		{
			throw new Error(`The reviewed provider catalogue repeats provider ${provider.name}`);
		}

		if (
			!Array.isArray(provider.models)
			|| !provider.models.length
			|| !provider.models.includes(provider.defaultModel)
		)
		{
			throw new Error(`Provider ${provider.name} must list its default model`);
		}

		providerNames.add(provider.name);

		for (const model of provider.models)
		{
			if (!_MODEL_PATTERN.test(model) || !model.startsWith(`${provider.litellmProvider}/`))
			{
				throw new Error(`Provider ${provider.name} contains an invalid LiteLLM model`);
			}

			if (modelNames.has(model))
			{
				throw new Error(`The reviewed provider catalogue repeats model ${model}`);
			}

			modelNames.add(model);
		}
	}

	return providers;
}

/**
 * Returns the hidden credential filename allowed for a provider in the catalog.
 *
 * Called by: local selection and remote-key separation.
 * @param {{ name: string }} provider - Reviewed provider.
 * @returns {string} Filename expected directly under the repository's `keys/` directory.
 */
function createLocalProviderKeyFileName(provider)
{
	return `.${provider.name}-key`;
}

/**
 * Selects a reviewed workstation provider and model without reading credential bytes.
 *
 * An explicit provider or model wins, followed by the configured default and then the first
 * recognized key filename in lexical order. A selected provider without its matching owner-only
 * key file is refused.
 *
 * Called by: secret-free configuration generation for `local-llm`.
 * @param {{ repositoryRoot: string, provider?: string, defaultProvider?: string, model?: string }} options - Selection inputs.
 * @returns {{ provider: { name: string, litellmProvider: string, defaultModel: string, models: string[] }, model: string, providerKeyPath: string }} Selected authority and key path.
 */
export function resolveLocalProviderSelection(options)
{
	const providers = readLocalProviderCatalog();
	const keysDirectory = path.join(options.repositoryRoot, "keys");
	let keyNames;

	try
	{
		const statistics = fs.lstatSync(keysDirectory);

		if (statistics.isSymbolicLink() || !statistics.isDirectory())
		{
			throw new Error(`The local provider-key path must be a real directory: ${keysDirectory}`);
		}

		keyNames = new Set(fs.readdirSync(keysDirectory));
	}
	catch (error)
	{
		if (error?.code === "ENOENT")
		{
			throw new Error(`The local provider-key directory is missing: ${keysDirectory}`);
		}

		throw error;
	}

	const configuredProviders = providers
		.filter((provider) =>
		{
			return keyNames.has(createLocalProviderKeyFileName(provider));
		})
		.sort((left, right) =>
		{
			const leftName = createLocalProviderKeyFileName(left);
			const rightName = createLocalProviderKeyFileName(right);

			if (leftName < rightName)
			{
				return -1;
			}

			if (leftName > rightName)
			{
				return 1;
			}

			return 0;
		});
	const requestedProvider = _findRequestedProvider(providers, options.provider, options.model);
	const defaultProvider = requestedProvider || !options.defaultProvider
		? undefined
		: _findRequestedProvider(providers, options.defaultProvider);
	const selectedProvider = requestedProvider ?? defaultProvider ?? configuredProviders[0];

	if (!selectedProvider)
	{
		const expected = providers.map(createLocalProviderKeyFileName).sort().join(", ");
		throw new Error(`local-llm requires one reviewed provider key in keys/: ${expected}`);
	}

	if (!configuredProviders.some((provider) => provider.name === selectedProvider.name))
	{
		throw new Error(`Provider ${selectedProvider.name} requires keys/${createLocalProviderKeyFileName(selectedProvider)}`);
	}

	const providerKeyPath = path.join(keysDirectory, createLocalProviderKeyFileName(selectedProvider));
	_requireOwnerOnlyCredential(providerKeyPath);

	return {
		provider: selectedProvider,
		model: options.model ?? selectedProvider.defaultModel,
		providerKeyPath
	};
}

/**
 * Selects a reviewed provider from provider-specific Codespaces credentials.
 *
 * An explicit provider or model wins, followed by the configured default and then the first
 * non-empty reviewed credential variable in lexical order. An unreviewed credential variable or a
 * selected provider without its matching variable is refused.
 *
 * Called by: the Tier 2 coordinator when its configuration includes a Codespaces name.
 * @param {{ provider?: string, defaultProvider?: string, model?: string }} options - Explicit selection and optional default.
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} environment - Codespaces worker environment.
 * @returns {{ provider: { name: string, litellmProvider: string, defaultModel: string, models: string[] }, model: string, providerKeyEnvironmentVariable: string }} Reviewed selection and exact credential variable.
 */
export function resolveCodespacesProviderSelection(options, environment)
{
	const providers = readLocalProviderCatalog();
	const configuredCredentials = discoverCodespacesProviderCredentials(providers, environment);
	const requestedProvider = _findRequestedProvider(providers, options.provider, options.model);
	const defaultProvider = requestedProvider || !options.defaultProvider
		? undefined
		: _findRequestedProvider(providers, options.defaultProvider);
	const selectedProvider = requestedProvider ?? defaultProvider ?? configuredCredentials[0]?.provider;

	if (!selectedProvider)
	{
		const expected = providers.map(createCodespacesProviderKeyEnvironmentVariable).sort().join(", ");
		throw new Error(`Codespaces local-llm requires one reviewed provider secret: ${expected}`);
	}

	const credential = configuredCredentials.find((entry) => entry.provider.name === selectedProvider.name);

	if (!credential)
	{
		const environmentVariable = createCodespacesProviderKeyEnvironmentVariable(selectedProvider);
		throw new Error(`Provider ${selectedProvider.name} requires the ${environmentVariable} Codespaces secret`);
	}

	return {
		provider: selectedProvider,
		model: options.model ?? selectedProvider.defaultModel,
		providerKeyEnvironmentVariable: credential.environmentVariable
	};
}

/**
 * Reads a selected model credential after regular-file, symlink, permission, and emptiness checks.
 *
 * Called by: the Tier 2 coordinator after it resolves a credential plan.
 * @param {string} credentialPath - Exact credential path selected by the plan.
 * @returns {string} Secret value with surrounding whitespace removed.
 */
export function readOwnerOnlyCredentialFile(credentialPath)
{
	_requireOwnerOnlyCredential(credentialPath);
	const credential = fs.readFileSync(credentialPath, "utf8").trim();

	if (!credential)
	{
		throw new Error(`The model credential file is empty: ${credentialPath}`);
	}

	return credential;
}

/**
 * Selects the credential source reserved for the requested model alternative.
 *
 * Called by: the Tier 2 coordinator before it reads a credential or starts a model transport.
 * @param {{ alternative: string, repositoryRoot: string, codespaceName?: string, provider?: string, defaultProvider?: string, model?: string, remoteLiteLLMMasterKeyFile?: string }} options - Parsed alternative and optional Codespaces marker.
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} environment - Worker environment used only for Codespaces credential discovery.
 * @returns {{ kind: "local", credentialSource: "codespaces-environment" | "owner-only-file", selection: ReturnType<typeof resolveLocalProviderSelection> | ReturnType<typeof resolveCodespacesProviderSelection> } | { kind: "remote", remoteMasterKeyPath: string } | { kind: "simulated" }} Selected credential source without its value.
 */
export function createModelCredentialPlan(options, environment = process.env)
{
	if (options.alternative === "local-llm")
	{
		const codespaces = Boolean(options.codespaceName);
		const selection = codespaces
			? resolveCodespacesProviderSelection(options, environment)
			: resolveLocalProviderSelection(options);

		return {
			kind: "local",
			credentialSource: codespaces ? "codespaces-environment" : "owner-only-file",
			selection
		};
	}

	if (options.alternative === "simulated-llm")
	{
		return { kind: "simulated" };
	}

	if (options.alternative !== "remote-llm" || !options.remoteLiteLLMMasterKeyFile)
	{
		throw new Error("The model alternative must be local-llm, remote-llm with an admin-key file, or simulated-llm");
	}

	const remoteMasterKeyPath = path.resolve(options.repositoryRoot, options.remoteLiteLLMMasterKeyFile);
	const localKeyPaths = new Set(readLocalProviderCatalog().map((provider) =>
	{
		return path.resolve(options.repositoryRoot, "keys", createLocalProviderKeyFileName(provider));
	}));

	if (localKeyPaths.has(remoteMasterKeyPath))
	{
		throw new Error("A remote LiteLLM admin key must not reuse a local provider-key file");
	}

	_requireOwnerOnlyCredential(remoteMasterKeyPath);
	return { kind: "remote", remoteMasterKeyPath };
}
