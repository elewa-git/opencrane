export const LOCAL_DEVELOPMENT_PROFILES = Object.freeze({
	Core: "core",
	Agent: "agent"
});

export const LOCAL_DEVELOPMENT_ALTERNATIVES = Object.freeze({
	LocalLiteLLM: "A",
	RemoteLiteLLM: "B",
	Simulated: "C"
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
		throw new Error("--alternative must be exactly A, B, or C");
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

export function parseLocalDevelopmentArguments(argumentsList)
{
	const parsed = {
		profile: LOCAL_DEVELOPMENT_PROFILES.Core,
		alternative: undefined,
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

	_assertKnownProfile(parsed.profile);

	if (parsed.profile === LOCAL_DEVELOPMENT_PROFILES.Core)
	{
		if (parsed.alternative || parsed.remoteLiteLLMEndpoint || parsed.remoteLiteLLMMasterKeyFile)
		{
			throw new Error("LiteLLM alternatives apply only to --profile agent");
		}

		return parsed;
	}

	parsed.alternative ??= LOCAL_DEVELOPMENT_ALTERNATIVES.LocalLiteLLM;
	_assertKnownAlternative(parsed.alternative);

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
