const _PROVIDER_CREDENTIAL_SUFFIX = "_TIER2_PROVIDER_API_KEY";

/**
 * Builds the Codespaces credential-variable name for a provider from the reviewed catalogue.
 *
 * Catalogue names are lowercase and may contain hyphens; Codespaces names use uppercase letters
 * and underscores.
 */
export function createCodespacesProviderKeyEnvironmentVariable(provider)
{
	const providerName = provider.name.toUpperCase().replaceAll("-", "_");
	return `${providerName}${_PROVIDER_CREDENTIAL_SUFFIX}`;
}

/** Checks whether an environment entry claims to contain a Tier 2 provider credential. */
function _isTier2ProviderCredential(name)
{
	return name.endsWith(_PROVIDER_CREDENTIAL_SUFFIX);
}

/**
 * Lists non-empty Codespaces credentials that match reviewed provider names.
 *
 * Unknown matching variables fail closed so a misspelled provider name cannot silently select a
 * different credential. OpenCrane requires uppercase credential-variable names in Codespaces;
 * workstation credential filenames embed the lowercase provider name, as in `keys/.openai-key`.
 * @param {{ name: string }[]} providers - Providers from the reviewed model-routing catalogue.
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} environment - Worker environment supplied by Codespaces.
 * @returns {{ environmentVariable: string, provider: { name: string } }[]} Credentials ordered by their environment-variable names.
 */
export function discoverCodespacesProviderCredentials(providers, environment)
{
	const providersByEnvironmentVariable = new Map(providers.map((provider) =>
	{
		return [createCodespacesProviderKeyEnvironmentVariable(provider), provider];
	}));
	const credentials = [];
	const unknownVariables = [];
	const selectedProviders = new Set();

	for (const [environmentVariable, value] of Object.entries(environment))
	{
		if (!_isTier2ProviderCredential(environmentVariable) || !value?.trim())
			continue;

		const provider = providersByEnvironmentVariable.get(environmentVariable);

		if (!provider)
		{
			unknownVariables.push(environmentVariable);
			continue;
		}

		if (selectedProviders.has(provider.name))
			throw new Error(`Codespaces repeats the Tier 2 credential for provider ${provider.name}`);

		selectedProviders.add(provider.name);
		credentials.push({ environmentVariable, provider });
	}

	if (unknownVariables.length)
	{
		unknownVariables.sort();
		throw new Error(`Codespaces contains Tier 2 credentials for unreviewed providers: ${unknownVariables.join(", ")}`);
	}

	credentials.sort((left, right) => left.environmentVariable.localeCompare(right.environmentVariable));
	return credentials;
}

/**
 * Removes every Tier 2 provider credential from the worker environment and returns the selected one.
 *
 * The coordinator calls this before validation starts child commands. It supplies the returned
 * value explicitly only when Docker starts local LiteLLM.
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} environment - Mutable worker environment.
 * @param {string} selectedEnvironmentVariable - Exact reviewed variable selected for this launch.
 * @returns {string} Non-empty provider credential with surrounding whitespace removed.
 */
export function takeCodespacesProviderCredential(environment, selectedEnvironmentVariable)
{
	const credential = environment[selectedEnvironmentVariable]?.trim() ?? "";

	for (const environmentVariable of Object.keys(environment))
	{
		if (_isTier2ProviderCredential(environmentVariable))
			delete environment[environmentVariable];
	}

	if (!credential)
		throw new Error(`Codespaces local-llm requires the ${selectedEnvironmentVariable} development-environment secret`);

	return credential;
}
