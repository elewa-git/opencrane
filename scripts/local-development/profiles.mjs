/**
 * Defines the process compositions accepted by the Tier 2 CLI.
 * Core excludes Agent services, while Agent enables one of the model-boundary alternatives below.
 */
export const LOCAL_DEVELOPMENT_PROFILES = Object.freeze({
	Core: "core",
	Agent: "agent"
});

/**
 * Defines the CLI values that select a local proxy, an explicit remote proxy, or deterministic
 * simulation. The parser rejects every other value before the coordinator chooses credentials or
 * starts processes.
 */
export const LOCAL_DEVELOPMENT_ALTERNATIVES = Object.freeze({
	LocalLiteLLM: "local-llm",
	RemoteLiteLLM: "remote-llm",
	Simulated: "simulated-llm"
});

function _readOptionValue(argumentsList, index, option)
{
	const value = argumentsList[index + 1];

	if (!value || value.startsWith("--"))
	{
		throw new Error(`${option} requires a value`);
	}

	return value;
}

function _assertKnownProfile(profile)
{
	if (!Object.values(LOCAL_DEVELOPMENT_PROFILES).includes(profile))
	{
		throw new Error("--profile must be exactly core or agent");
	}
}

function _assertKnownAlternative(alternative)
{
	if (!Object.values(LOCAL_DEVELOPMENT_ALTERNATIVES).includes(alternative))
	{
		throw new Error("--alternative must be exactly local-llm, remote-llm, or simulated-llm");
	}
}

function _validateRemoteEndpoint(endpoint)
{
	let parsed;

	try
	{
		parsed = new URL(endpoint);
	}
	catch
	{
		throw new Error("Alternative B requires a valid --remote-litellm-endpoint URL");
	}

	if (parsed.protocol !== "https:")
	{
		throw new Error("Alternative B requires an HTTPS LiteLLM endpoint");
	}

	if (parsed.pathname !== "/" || parsed.username || parsed.password || parsed.search || parsed.hash)
	{
		throw new Error("The remote LiteLLM endpoint must be an origin without credentials, a path, a query, or a fragment");
	}

	if (["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname))
	{
		throw new Error("Alternative B requires a non-loopback LiteLLM endpoint");
	}

	return parsed.toString().replace(/\/$/, "");
}

/**
 * Parses Tier 2 arguments and rejects options that do not apply to the selected profile.
 * Agent defaults to `local-llm`; `remote-llm` requires an HTTPS origin and key-file path before the
 * coordinator can start, while core refuses every Agent alternative. Alternative A accepts an
 * exact model from the reviewed registry and derives its provider-key path.
 *
 * Called by: `scripts/local-development.mjs` before configuration or process orchestration.
 * @param {string[]} argumentsList - Command-line arguments after the local-development script name.
 * @returns The validated profile, alternative, remote settings, and coordinator flags. A help request returns before profile-specific requirements are checked.
 * @throws When an option is unknown, incomplete, or incompatible with the selected profile.
 */
export function parseLocalDevelopmentArguments(argumentsList)
{
	const parsed = {
		profile: LOCAL_DEVELOPMENT_PROFILES.Core,
		alternative: undefined,
		model: undefined,
		remoteLiteLLMEndpoint: undefined,
		remoteLiteLLMMasterKeyFile: undefined,
		reset: false,
		help: false
	};

	for (let index = 0; index < argumentsList.length; index += 1)
	{
		const argument = argumentsList[index];

		switch (argument)
		{
			case "--profile":
				parsed.profile = _readOptionValue(argumentsList, index, argument);
				index += 1;
				break;
			case "--alternative":
				parsed.alternative = _readOptionValue(argumentsList, index, argument);
				index += 1;
				break;
			case "--model":
				parsed.model = _readOptionValue(argumentsList, index, argument);
				index += 1;
				break;
			case "--remote-litellm-endpoint":
				parsed.remoteLiteLLMEndpoint = _readOptionValue(argumentsList, index, argument);
				index += 1;
				break;
			case "--remote-litellm-master-key-file":
				parsed.remoteLiteLLMMasterKeyFile = _readOptionValue(argumentsList, index, argument);
				index += 1;
				break;
			case "--reset":
				parsed.reset = true;
				break;
			case "--help":
				parsed.help = true;
				break;
			default:
				throw new Error(`Unknown local-development option: ${argument}`);
		}
	}

	if (parsed.help)
	{
		return parsed;
	}

	_assertKnownProfile(parsed.profile);

	if (parsed.profile === LOCAL_DEVELOPMENT_PROFILES.Core)
	{
		if (parsed.alternative || parsed.model || parsed.remoteLiteLLMEndpoint || parsed.remoteLiteLLMMasterKeyFile)
		{
			throw new Error("LiteLLM alternatives and provider settings apply only to --profile agent");
		}

		return parsed;
	}

	parsed.alternative ??= LOCAL_DEVELOPMENT_ALTERNATIVES.LocalLiteLLM;
	_assertKnownAlternative(parsed.alternative);

	if (parsed.model && parsed.alternative !== LOCAL_DEVELOPMENT_ALTERNATIVES.LocalLiteLLM)
	{
		throw new Error("--model applies only to Alternative A (local-llm)");
	}

	if (parsed.alternative === LOCAL_DEVELOPMENT_ALTERNATIVES.RemoteLiteLLM)
	{
		if (!parsed.remoteLiteLLMEndpoint || !parsed.remoteLiteLLMMasterKeyFile)
		{
			throw new Error("Alternative B requires both --remote-litellm-endpoint and --remote-litellm-master-key-file");
		}

		parsed.remoteLiteLLMEndpoint = _validateRemoteEndpoint(parsed.remoteLiteLLMEndpoint);
	}
	else if (parsed.remoteLiteLLMEndpoint || parsed.remoteLiteLLMMasterKeyFile)
	{
		throw new Error("Remote LiteLLM options apply only to Alternative B");
	}

	return parsed;
}
