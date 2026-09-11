/** Tier 2 process compositions accepted by the CLI. */
const LOCAL_DEVELOPMENT_PROFILES = Object.freeze({ Core: "core", Agent: "agent" });

/** Model transports accepted by the Agent profile. */
export const LOCAL_DEVELOPMENT_ALTERNATIVES = Object.freeze({
	LocalLiteLLM: "local-llm",
	RemoteLiteLLM: "remote-llm",
	Simulated: "simulated-llm"
});

/** Reads one required option value without accepting another option as its value. */
function _readValue(argumentsList, index, option)
{
	const value = argumentsList[index + 1];

	if (!value || value.startsWith("--"))
	{
		throw new Error(`${option} requires a value`);
	}

	return value;
}

/** Requires a remote model gateway to be an HTTPS origin without embedded credentials. */
function _validateRemoteEndpoint(value)
{
	let endpoint;

	try
	{
		endpoint = new URL(value);
	}
	catch
	{
		throw new Error("--remote-litellm-endpoint must be a valid HTTPS origin");
	}

	if (endpoint.protocol !== "https:" || endpoint.pathname !== "/" || endpoint.username || endpoint.password || endpoint.search || endpoint.hash)
	{
		throw new Error("--remote-litellm-endpoint must be an HTTPS origin without credentials, a path, a query, or a fragment");
	}

	if (["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname))
	{
		throw new Error("--remote-litellm-endpoint must not be loopback");
	}

	return endpoint.origin;
}

/** Parses the strict Tier 2 CLI contract before any host resource can be acquired. */
export function parseLocalDevelopmentArguments(argumentsList)
{
	const parsed = {
		profile: undefined,
		alternative: undefined,
		provider: undefined,
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
				parsed.profile = _readValue(argumentsList, index, argument);
				index += 1;
				break;
			case "--alternative":
				parsed.alternative = _readValue(argumentsList, index, argument);
				index += 1;
				break;
			case "--provider":
				parsed.provider = _readValue(argumentsList, index, argument);
				index += 1;
				break;
			case "--model":
				parsed.model = _readValue(argumentsList, index, argument);
				index += 1;
				break;
			case "--remote-litellm-endpoint":
				parsed.remoteLiteLLMEndpoint = _readValue(argumentsList, index, argument);
				index += 1;
				break;
			case "--remote-litellm-master-key-file":
				parsed.remoteLiteLLMMasterKeyFile = _readValue(argumentsList, index, argument);
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

	if (!Object.values(LOCAL_DEVELOPMENT_PROFILES).includes(parsed.profile))
	{
		throw new Error("--profile must be exactly core or agent");
	}

	if (parsed.profile === LOCAL_DEVELOPMENT_PROFILES.Core)
	{
		if (parsed.alternative || parsed.provider || parsed.model || parsed.remoteLiteLLMEndpoint || parsed.remoteLiteLLMMasterKeyFile)
		{
			throw new Error("Model alternatives apply only to --profile agent");
		}

		return parsed;
	}

	parsed.alternative ??= LOCAL_DEVELOPMENT_ALTERNATIVES.LocalLiteLLM;

	if (!Object.values(LOCAL_DEVELOPMENT_ALTERNATIVES).includes(parsed.alternative))
	{
		throw new Error("--alternative must be exactly local-llm, remote-llm, or simulated-llm");
	}

	if (parsed.alternative === LOCAL_DEVELOPMENT_ALTERNATIVES.LocalLiteLLM)
	{
		if (parsed.remoteLiteLLMEndpoint || parsed.remoteLiteLLMMasterKeyFile)
		{
			throw new Error("Remote LiteLLM options apply only to remote-llm");
		}

		return parsed;
	}

	if (parsed.provider || parsed.model)
	{
		throw new Error("Local provider options apply only to local-llm");
	}

	if (parsed.alternative === LOCAL_DEVELOPMENT_ALTERNATIVES.RemoteLiteLLM)
	{
		if (!parsed.remoteLiteLLMEndpoint || !parsed.remoteLiteLLMMasterKeyFile)
		{
			throw new Error("remote-llm requires --remote-litellm-endpoint and --remote-litellm-master-key-file");
		}

		parsed.remoteLiteLLMEndpoint = _validateRemoteEndpoint(parsed.remoteLiteLLMEndpoint);
	}
	else if (parsed.remoteLiteLLMEndpoint || parsed.remoteLiteLLMMasterKeyFile)
	{
		throw new Error("Remote LiteLLM options apply only to remote-llm");
	}

	return parsed;
}
