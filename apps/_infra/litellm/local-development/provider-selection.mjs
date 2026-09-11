import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

function _compareProviderKeyNames(left, right)
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
}

function _findRequestedProvider(providers, providerName, modelName)
{
	const namedProvider = providerName
		? providers.find(function _HasProviderName(provider) { return provider.name === providerName; })
		: undefined;
	const modelProvider = modelName
		? providers.find(function _OwnsModel(provider) { return provider.models.includes(modelName); })
		: undefined;

	if (providerName && !namedProvider)
	{
		throw new Error(`Provider ${providerName} is not in the reviewed catalogue`);
	}

	if (modelName && !modelProvider)
	{
		throw new Error(`Model ${modelName} is not in the reviewed catalogue`);
	}

	if (namedProvider && modelProvider && namedProvider.name !== modelProvider.name)
	{
		throw new Error(`Model ${modelName} does not belong to provider ${providerName}`);
	}

	return namedProvider ?? modelProvider;
}

/**
 * Reads the production-owned BYOK catalogue and rejects duplicate or ambiguous provider authority.
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

	if (!contract || Array.isArray(contract) || typeof contract !== "object")
	{
		throw new Error("The reviewed provider catalogue must be an object");
	}
	const providers = Object.entries(contract).map(function _Provider([name, provider])
	{
		if (!provider || typeof provider !== "object" || Array.isArray(provider) || !Array.isArray(provider.models))
		{
			throw new Error(`Provider ${name} must declare its reviewed model catalogue`);
		}
		const validModels = provider.models.every(function _ValidModel(model)
		{
			return model && typeof model === "object" && !Array.isArray(model) && typeof model.className === "string" && typeof model.slug === "string";
		});
		if (!validModels || typeof provider.defaultClass !== "string" || typeof provider.litellmProvider !== "string")
		{
			throw new Error(`Provider ${name} has invalid reviewed model entries`);
		}
		const defaultModel = provider.models.find(function _Default(model) { return model.className === provider.defaultClass; });
		return { name, litellmProvider: provider.litellmProvider, defaultModel: defaultModel?.slug, models: provider.models.map(function _Slug(model) { return model.slug; }) };
	});
	if (providers.length === 0)
	{
		throw new Error("The reviewed provider catalogue must contain at least one provider");
	}

	const providerNames = new Set();
	const modelNames = new Set();

	for (const provider of providers)
	{
		if (!provider || !_PROVIDER_PATTERN.test(provider.name) || !_PROVIDER_PATTERN.test(provider.litellmProvider))
		{
			throw new Error("Every reviewed local provider must have lowercase provider names");
		}

		if (providerNames.has(provider.name))
		{
			throw new Error(`The reviewed provider catalogue repeats provider ${provider.name}`);
		}

		if (!Array.isArray(provider.models) || provider.models.length === 0 || !provider.models.includes(provider.defaultModel))
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
 * Derives the only admitted hidden credential filename for a reviewed provider.
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
 * Selects a reviewed local provider and model without reading credential bytes.
 *
 * Called by: secret-free configuration generation for `local-llm`.
 * @param {{ repositoryRoot: string, provider?: string, model?: string }} options - Selection inputs.
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
		.filter(function _HasConventionalKey(provider)
		{
			return keyNames.has(createLocalProviderKeyFileName(provider));
		})
		.sort(_compareProviderKeyNames);
	const requestedProvider = _findRequestedProvider(providers, options.provider, options.model);
	const selectedProvider = requestedProvider ?? configuredProviders[0];

	if (!selectedProvider)
	{
		const expected = providers.map(createLocalProviderKeyFileName).sort().join(", ");
		throw new Error(`local-llm requires one reviewed provider key in keys/: ${expected}`);
	}

	if (!configuredProviders.some(function _IsSelected(provider) { return provider.name === selectedProvider.name; }))
	{
		throw new Error(`Provider ${selectedProvider.name} requires keys/${createLocalProviderKeyFileName(selectedProvider)}`);
	}

	const providerKeyPath = path.join(keysDirectory, createLocalProviderKeyFileName(selectedProvider));
	_requireOwnerOnlyCredential(providerKeyPath);
	return { provider: selectedProvider, model: options.model ?? selectedProvider.defaultModel, providerKeyPath };
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
 * Keeps local, remote, and simulated model alternatives on disjoint credential paths.
 *
 * Called by: the Tier 2 coordinator before it reads secrets or starts a model transport.
 * @param {{ alternative: string, repositoryRoot: string, provider?: string, model?: string, remoteLiteLLMMasterKeyFile?: string }} options - Parsed alternative.
 * @returns {{ kind: "local", selection: ReturnType<typeof resolveLocalProviderSelection> } | { kind: "remote", remoteMasterKeyPath: string } | { kind: "simulated" }} Credential paths without values.
 */
export function createModelCredentialPlan(options)
{
	if (options.alternative === "local-llm")
	{
		return { kind: "local", selection: resolveLocalProviderSelection(options) };
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
	const localKeyPaths = new Set(readLocalProviderCatalog().map(function _ToLocalKeyPath(provider)
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
