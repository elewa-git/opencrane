import { lstat, readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";

import { readLocalProviderCatalog } from "../../apps/_infra/litellm/local-development/provider-selection.mjs";

const _PROVIDER_CREDENTIAL_SUFFIX = "_TIER3_PROVIDER_API_KEY";
export const TIER3_DEFAULT_PROVIDER_ENVIRONMENT_VARIABLE = "OPENCRANE_TIER3_DEFAULT_PROVIDER";

/**
 * Builds the provider-specific Codespaces secret name for one reviewed provider.
 * @param {{ name: string }} provider - Provider from the reviewed BYOK catalog.
 * @returns {string} Uppercase provider-specific Tier 3 credential variable.
 */
export function createTier3ProviderKeyEnvironmentVariable(provider)
{
	const providerName = provider.name.toUpperCase().replaceAll("-", "_");
	return `${providerName}${_PROVIDER_CREDENTIAL_SUFFIX}`;
}

/**
 * Removes every Tier 3 provider credential from a mutable worker environment.
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} environment - Coordinator environment.
 */
export function removeTier3ProviderCredentials(environment)
{
	for (const environmentVariable of Object.keys(environment))
	{
		if (environmentVariable.endsWith(_PROVIDER_CREDENTIAL_SUFFIX))
			delete environment[environmentVariable];
	}
}

/**
 * Finds non-empty provider-specific Tier 3 secrets and rejects names outside the reviewed catalog.
 * Results are sorted by environment-variable name so the implicit fallback is deterministic.
 * @param {{ name: string }[]} providers - Providers from the reviewed BYOK catalog.
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} environment - Coordinator environment.
 * @returns {{ environmentVariable: string, provider: { name: string } }[]} Reviewed credentials in lexical order.
 */
export function discoverTier3ProviderCredentials(providers, environment)
{
	const providersByEnvironmentVariable = new Map(providers.map((provider) =>
	{
		return [createTier3ProviderKeyEnvironmentVariable(provider), provider];
	}));
	const credentials = [];
	const unknownVariables = [];

	for (const [environmentVariable, value] of Object.entries(environment))
	{
		if (!environmentVariable.endsWith(_PROVIDER_CREDENTIAL_SUFFIX) || !value?.trim())
			continue;

		const provider = providersByEnvironmentVariable.get(environmentVariable);

		if (!provider)
		{
			unknownVariables.push(environmentVariable);
			continue;
		}

		credentials.push({ environmentVariable, provider });
	}

	if (unknownVariables.length)
	{
		unknownVariables.sort();
		throw new Error(`Codespaces contains Tier 3 credentials for unreviewed providers: ${unknownVariables.join(", ")}`);
	}

	credentials.sort((left, right) => left.environmentVariable.localeCompare(right.environmentVariable));
	return credentials;
}

/**
 * Reads a provider key from an absolute, owner-only regular file and rejects a symbolic-link path.
 * @param {string} path - Absolute provider-key path selected for a workstation launch.
 * @returns The trimmed, non-empty provider key.
 * @throws When the credential path, permissions, type or contents are unsafe.
 */
export async function readTier3ProviderKey(path)
{
	if (!isAbsolute(path))
		throw new Error("Tier 3 provider key file must use an absolute path.");

	const metadata = await lstat(path);

	if (!metadata.isFile() || metadata.isSymbolicLink())
		throw new Error("Tier 3 provider key must be an ordinary file, not a link.");

	if ((metadata.mode & 0o077) !== 0)
		throw new Error("Tier 3 provider key file must be owner-only; run chmod 600 on it.");

	const key = (await readFile(path, "utf8")).trim();

	if (!key)
		throw new Error("Tier 3 provider key file is empty.");

	return key;
}

/**
 * Selects and consumes the Agent profile's provider credential before any child process starts.
 * @param {{ profile: string, provider?: string | null, defaultProvider?: string | null, providerKeyFile?: string | null }} options - Parsed Tier 3 options.
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} environment - Mutable coordinator environment.
 * @returns {Promise<{ provider: string, providerKey: string } | null>} Selected Agent credential, or null for infrastructure.
 * @throws When the selected provider or credential does not satisfy its environment contract.
 */
export async function prepareTier3ProviderCredentials(options, environment)
{
	if (options.profile === "infra")
	{
		removeTier3ProviderCredentials(environment);
		return null;
	}

	const providers = readLocalProviderCatalog();
	const providersByName = new Map(providers.map((provider) => [provider.name, provider]));
	const environmentDefault = environment[TIER3_DEFAULT_PROVIDER_ENVIRONMENT_VARIABLE]?.trim().toLowerCase() || null;
	const defaultProviderName = options.defaultProvider ?? environmentDefault;

	if (options.provider && !providersByName.has(options.provider))
		throw new Error("Tier 3 provider must be one of " + providers.map((provider) => provider.name).join(", ") + ".");

	if (!options.provider && defaultProviderName && !providersByName.has(defaultProviderName))
		throw new Error(`Tier 3 default provider must be one of ${providers.map((provider) => provider.name).join(", ")}.`);

	if (options.defaultProvider)
		environment[TIER3_DEFAULT_PROVIDER_ENVIRONMENT_VARIABLE] = options.defaultProvider;

	if (environment.CODESPACES === "true")
	{
		if (options.providerKeyFile)
			throw new Error("Tier 3 Codespaces reads provider-specific secrets and refuses --provider-key-file.");

		const configuredCredentials = discoverTier3ProviderCredentials(providers, environment);
		const provider = providersByName.get(options.provider ?? defaultProviderName) ?? configuredCredentials[0]?.provider;

		if (!provider)
		{
			const expected = providers.map(createTier3ProviderKeyEnvironmentVariable).sort().join(", ");
			throw new Error(`Tier 3 Codespaces requires one reviewed provider secret: ${expected}`);
		}

		const environmentVariable = createTier3ProviderKeyEnvironmentVariable(provider);
		const providerKey = environment[environmentVariable]?.trim() ?? "";
		removeTier3ProviderCredentials(environment);

		if (!providerKey)
			throw new Error(`Tier 3 provider ${provider.name} requires the ${environmentVariable} Codespaces secret.`);

		return { provider: provider.name, providerKey };
	}

	removeTier3ProviderCredentials(environment);
	const providerName = options.provider ?? defaultProviderName;

	if (!providerName || !options.providerKeyFile)
		throw new Error("Tier 3 agent on a workstation requires --provider or --default-provider and --provider-key-file.");

	const providerKey = await readTier3ProviderKey(options.providerKeyFile);
	return { provider: providerName, providerKey };
}
